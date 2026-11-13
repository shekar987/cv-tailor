import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, declaresMoreThan } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { parseCvFile, detectFileKind, CvParseError, MAX_FILE_BYTES } from "@/lib/parseCv";
import { MAX_JD_CHARS, JD_TOO_LONG } from "@/lib/limits";
import { DEFAULT_TIMEZONE, dayKey } from "@/lib/planTime";
import { cleanNoteLine, stampNoteLine } from "@/lib/notesWrite";
import { apiStatus, oldStatusLabel } from "@/lib/tracker";
import { sha256Hex } from "@/lib/idempotency";
import { idempotent } from "@/lib/idempotentRoute";
import { FOLLOWUP_ERROR, followupTooEarly, readLoggedBy, validateEditable } from "@/lib/applicationFields";
import { MAX_APPLICATIONS, readApplicationPages, type OrderableQuery } from "@/lib/applicationRows";
import { triageForUser, withTriage } from "@/lib/applicationTriage";
import {
  LOG_DEFAULT_LOGGED_BY,
  duplicateMessage,
  findRecentDuplicate,
  logFormFingerprint,
  readForce,
  readLogForm,
  readLogSource,
  windowStart,
  type FormEntry,
  type LogFileField,
  type LoggedRow,
} from "@/lib/applicationLog";
import {
  SENT_CV_BUCKET,
  contentTypeFor,
  displayFileName,
  publicSentCv,
  sentCvPath,
  textNoteFor,
  type SentCv,
  type SentCvKind,
  type SentDoc,
} from "@/lib/sentCv";

// POST /api/applications/log (12 Nov 2026, Chunk 22): one tracker row with the files that
// were sent, in ONE multipart request — the row, its job description, a stamped note, the
// CV (`cv`) and the cover letter (`cover_letter`), stored like /api/applications/cv stores
// them. Answers { ok, id, sentCv, sentCoverLetter }.
//
// All or nothing: the files are checked before anything is written, stored under the new
// row's id, and the row is inserted with them in one insert; a failure after a file was
// stored removes it again, so a retry starts clean. The same company and role logged in
// the last 90 days is a 409 with the row it matched (lib/applicationLog), unless force=1;
// an Idempotency-Key header makes a retry return the first answer.
//
// No model call; burst-limited (it parses and stores files), like the upload route.

export const runtime = "nodejs";
export const maxDuration = 60;

const PATH = "/api/applications/log";
// A sweep logs a morning's applications in one go: looser than the upload route's
// 10 a minute, still a ceiling on file parsing (no model call).
const LOG_LIMIT = { limit: 30, windowSeconds: 60 };
const PARSE_TIMEOUT_MS = 20_000;
const TOO_LARGE = "The files together are larger than 4MB. Send smaller files, or add them one at a time on the row.";
const CV_NOT_SET_UP =
  "Storing the CV you sent isn't set up in the database yet — run supabase/migrations/20260927120000_application_cvs.sql in the Supabase SQL editor.";
const LETTER_NOT_SET_UP =
  "Storing the cover letter you sent needs migration 20261112120000_fast_tracker_api.sql. Run it in the Supabase SQL editor, or log the row without the cover letter.";
const DATE_MIGRATION_HINT =
  "Logging a Ready to submit row without a date applied needs migration 20261112120000_fast_tracker_api.sql. Run it in the Supabase SQL editor, or send the date.";
const DEADLINE_KEYS = ["applied_from_email", "next_deadline", "deadline_note"] as const;
const DEADLINE_SAVED_WITHOUT =
  "Saved without the applied-from address and deadline: run migration 20261110120000_safe_notes_cooldowns_deadlines.sql in the Supabase SQL editor.";
const SAVE_FAILED = "Could not log that application. Nothing was saved.";

const DOC_OF: Record<LogFileField, SentDoc> = { cv: "cv", cover_letter: "cover_letter" };
const COLUMN_OF: Record<LogFileField, "sent_cv" | "sent_cover_letter"> = { cv: "sent_cv", cover_letter: "sent_cover_letter" };
const LABEL_OF: Record<LogFileField, string> = { cv: "The CV", cover_letter: "The cover letter" };

function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CvParseError("Reading the file took too long.", "timeout")), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// The form as lib/applicationLog reads it: text fields, and each file by name, size and hash.
async function formEntries(form: FormData): Promise<{ entries: FormEntry[]; files: Map<string, File> }> {
  const entries: FormEntry[] = [];
  const files = new Map<string, File>();
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") entries.push({ name, value });
    else {
      files.set(name, value);
      entries.push({ name, file: { name: value.name, size: value.size, sha256: sha256Hex(new Uint8Array(await value.arrayBuffer())) } });
    }
  }
  return { entries, files };
}

export async function POST(req: NextRequest) {
  return idempotent(
    req,
    PATH,
    async () => {
      if (declaresMoreThan(req, MAX_FILE_BYTES * 1.1)) return "too-large";
      try {
        return logFormFingerprint((await formEntries(await req.clone().formData())).entries);
      } catch {
        return "unreadable";
      }
    },
    () => logApplication(req)
  );
}

async function logApplication(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const burst = await checkBurstLimit(userId, "application-log", LOG_LIMIT);
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many logs. Please wait ${burst.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }
    if (declaresMoreThan(req, MAX_FILE_BYTES * 1.1)) return NextResponse.json({ error: TOO_LARGE }, { status: 400 });
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Send the application as multipart form data (fields, plus the cv and cover_letter files)." }, { status: 400 });
    }
    const { entries, files } = await formEntries(form);
    const read = readLogForm(entries);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
    const { body } = read;

    // The row's fields, by the same rules as POST /api/applications (lib/applicationFields).
    // Each refusal carries its own detail beside the sentence: `field`, and `allowed` or `max`
    // (Chunk 26), so a script never has to guess what would have been taken.
    const validated = validateEditable(body, false);
    if ("error" in validated) return NextResponse.json(validated, { status: 400 });
    const { fields } = validated;
    if (followupTooEarly(fields.date_applied, fields.followup_date ?? null)) return NextResponse.json({ error: FOLLOWUP_ERROR, field: "followup_date" }, { status: 400 });
    const source = readLogSource(body.source);
    if ("error" in source) return NextResponse.json(source, { status: 400 });
    const logged = readLoggedBy(body.logged_by);
    if ("error" in logged) return NextResponse.json({ error: logged.error }, { status: 400 });
    const jobDescription = (body.job_description ?? "").trim();
    if (jobDescription.length > MAX_JD_CHARS) return NextResponse.json({ error: JD_TOO_LONG }, { status: 400 });
    let notes: string | null = null;
    if (body.append_note !== undefined && body.append_note.trim() !== "") {
      const cleaned = cleanNoteLine(body.append_note);
      if ("error" in cleaned) return NextResponse.json(cleaned, { status: 400 });
      notes = stampNoteLine(cleaned.line, Date.now());
    }

    // The files, checked before anything is written: size, and the kind from the bytes.
    const uploads: { field: LogFileField; file: File; bytes: Uint8Array; kind: SentCvKind }[] = [];
    for (const field of read.files) {
      const file = files.get(field) as File;
      if (file.size === 0) return NextResponse.json({ error: `${LABEL_OF[field]} file is empty.` }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 400 });
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        uploads.push({ field, file, bytes, kind: detectFileKind(bytes, file.name || "") });
      } catch (err) {
        if (err instanceof CvParseError) return NextResponse.json({ error: `${LABEL_OF[field]}: ${err.message}`, code: err.code }, { status: 400 });
        throw err;
      }
    }
    if (uploads.reduce((n, u) => n + u.bytes.length, 0) > MAX_FILE_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 400 });

    // The same company and role in the last 90 days: say which row, unless force=1.
    const today = dayKey(Date.now(), DEFAULT_TIMEZONE);
    if (!readForce(body.force)) {
      const from = windowStart(fields.date_applied ?? today);
      const recent = await readApplicationPages<LoggedRow>(
        () =>
          supabase
            .from("applications")
            .select("id, company_name, role, status, date_applied, created_at, sent_cv_name:sent_cv->>fileName")
            .eq("user_id", userId)
            .or(`date_applied.gte.${from},date_applied.is.null`) as unknown as OrderableQuery
      );
      if (recent.error) {
        console.error("applications log duplicate read error:", recent.error.code ?? "unknown");
        return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
      }
      const match = findRecentDuplicate(recent.rows, { company_name: fields.company_name as string, role: fields.role as string, date_applied: fields.date_applied ?? null }, today);
      if (match) {
        return NextResponse.json(
          {
            error: "duplicate",
            errorType: "duplicate",
            message: duplicateMessage(match),
            existing: { id: match.id, company_name: match.company_name, role: match.role, status: apiStatus(match.status), date_applied: match.date_applied, has_sent_cv: !!match.sent_cv_name },
          },
          { status: 409 }
        );
      }
    }

    // The cap, from a count that is trusted (a failed count is an error, not zero).
    const { count, error: countError } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (countError) {
      console.error("applications log count error:", countError.code ?? "unknown");
      return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
    }
    if ((count ?? 0) >= MAX_APPLICATIONS) {
      return NextResponse.json({ error: `You can track up to ${MAX_APPLICATIONS} applications. Delete some to add more.` }, { status: 400 });
    }

    // The files go first, under the new row's id, so the row is inserted complete.
    const id = crypto.randomUUID();
    const now = Date.now();
    const storage = supabase.storage.from(SENT_CV_BUCKET);
    const stored: string[] = [];
    const removeStored = async () => {
      if (stored.length === 0) return;
      const { error } = await storage.remove(stored);
      if (error) console.warn("applications log: stored files not removed:", error.message);
    };
    const records: Partial<Record<LogFileField, SentCv>> = {};
    // The text is kept to show on the row; a file whose text can't be read is still kept.
    // The reader gets a COPY: pdf.js detaches the buffer it is handed (see lib/parseCv).
    const texts = await Promise.all(
      uploads.map(async (u) => {
        try {
          return { text: (await withTimeout(parseCvFile(u.bytes.slice(), u.file.name || ""), PARSE_TIMEOUT_MS)).text, note: "" };
        } catch (err) {
          if (!(err instanceof CvParseError)) console.warn("applications log: text read failed:", err instanceof Error ? err.message : "Unknown error");
          return { text: "", note: textNoteFor(err instanceof CvParseError ? err.code : "unreadable") };
        }
      })
    );
    for (const [i, u] of uploads.entries()) {
      const doc = DOC_OF[u.field];
      const path = sentCvPath(userId, id, u.file.name, u.kind, now, doc);
      const { error: uploadError } = await storage.upload(path, u.bytes, { contentType: contentTypeFor(u.kind), upsert: false });
      if (uploadError) {
        await removeStored();
        if (/bucket not found/i.test(uploadError.message)) return NextResponse.json({ error: CV_NOT_SET_UP, errorType: "needs_migration" }, { status: 503 });
        console.error("applications log upload error:", uploadError.message);
        return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
      }
      stored.push(path);
      records[u.field] = {
        version: 1,
        path,
        fileName: displayFileName(u.file.name, u.kind, doc),
        size: u.bytes.length,
        kind: u.kind,
        uploadedAt: new Date(now).toISOString(),
        text: texts[i].text,
        ...(texts[i].note ? { textNote: texts[i].note } : {}),
      };
    }

    const triage = jobDescription ? await triageForUser(supabase, userId, jobDescription) : null;
    const record: Record<string, unknown> = {
      ...fields,
      id,
      user_id: userId,
      source: source.source,
      notes,
      job_description: jobDescription || null,
      tailored_cv: withTriage({ loggedBy: logged.loggedBy ?? LOG_DEFAULT_LOGGED_BY }, triage),
      ...(records.cv ? { [COLUMN_OF.cv]: records.cv } : {}),
      ...(records.cover_letter ? { [COLUMN_OF.cover_letter]: records.cover_letter } : {}),
    };
    const insert = (row: Record<string, unknown>) => supabase.from("applications").insert(row).select("id").single();
    let { error: insertError } = await insert(record);
    let warning: string | undefined;
    const names = (err: { message?: string } | null, column: string) => (err?.message ?? "").includes(column);
    // No deadline columns yet: the row saves without them and says so (as POST does).
    if (insertError && isMissingColumn(insertError) && DEADLINE_KEYS.some((k) => k in record && names(insertError, k))) {
      for (const k of DEADLINE_KEYS) delete record[k];
      ({ error: insertError } = await insert(record));
      if (!insertError) warning = DEADLINE_SAVED_WITHOUT;
    }
    // A database without the newest status keys stores the old label.
    const oldLabel = insertError?.code === "23514" && fields.status ? oldStatusLabel(fields.status) : null;
    if (oldLabel) ({ error: insertError } = await insert({ ...record, status: oldLabel }));
    if (insertError) {
      await removeStored();
      if (isMissingColumn(insertError) && names(insertError, "sent_cover_letter")) return NextResponse.json({ error: LETTER_NOT_SET_UP, errorType: "needs_migration" }, { status: 503 });
      if (isMissingColumn(insertError) && names(insertError, "sent_cv")) return NextResponse.json({ error: CV_NOT_SET_UP, errorType: "needs_migration" }, { status: 503 });
      if (insertError.code === "23502" && fields.date_applied === null) return NextResponse.json({ error: DATE_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("applications log insert error:", insertError.code ?? "unknown", insertError.message);
      return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      id,
      sentCv: publicSentCv(records.cv ?? null),
      sentCoverLetter: publicSentCv(records.cover_letter ?? null),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    console.error("applications log error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
  }
}
