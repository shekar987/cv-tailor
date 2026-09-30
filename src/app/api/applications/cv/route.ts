import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, declaresMoreThan, type RouteSupabase } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { parseCvFile, detectFileKind, CvParseError, MAX_FILE_BYTES } from "@/lib/parseCv";
import { UPLOAD_TOO_LARGE } from "@/lib/limits";
import {
  SENT_CV_BUCKET,
  sentCvPath,
  ownsPath,
  normalizeSentCv,
  publicSentCv,
  contentTypeFor,
  contentDisposition,
  displayFileName,
  textNoteFor,
  type SentCv,
  type SentCvKind,
} from "@/lib/sentCv";

// The CV file a user sent for one application (lib/sentCv): POST uploads or
// replaces it, GET ?id= downloads it, DELETE ?id= removes it. Every call runs
// as the signed-in user, so both the table's RLS and the bucket's policies
// apply; the route also checks the row and the stored path's prefix itself.
//
// No model call. The burst limiter guards the upload (it parses and stores a
// file), the same way it guards /api/parse-cv.

// The PDF and DOCX readers need Node APIs (Buffer).
export const runtime = "nodejs";

const PARSE_TIMEOUT_MS = 20_000;
const NOT_SET_UP =
  "Uploading the CV you sent isn't set up in the database yet — run supabase/migrations/20260927120000_application_cvs.sql in the Supabase SQL editor, then try again.";
const TOO_LARGE = UPLOAD_TOO_LARGE;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
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

// The application row (own rows only) and whatever file it records.
async function readRow(
  supabase: RouteSupabase,
  userId: string,
  id: string
): Promise<{ found: false } | { found: true; sent: SentCv | null } | { missingColumn: true } | { error: string }> {
  const { data, error } = await supabase
    .from("applications")
    .select("id, sent_cv")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return isMissingColumn(error) ? { missingColumn: true } : { error: error.message };
  if (!data) return { found: false };
  return { found: true, sent: normalizeSentCv((data as { sent_cv?: unknown }).sent_cv) };
}

const notFound = () => NextResponse.json({ error: "Application not found" }, { status: 404 });

export async function POST(req: NextRequest) {
  try {
    const auth = await signedIn();
    if (!auth) return unauthorized();
    const { supabase, userId } = auth;

    const burst = await checkBurstLimit(userId, "application-cv");
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many uploads. Please wait ${burst.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    // Reject an oversized body from its header before buffering it.
    if (declaresMoreThan(req, MAX_FILE_BYTES * 1.1)) {
      return NextResponse.json({ error: TOO_LARGE }, { status: 400 });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
    }
    const id = form.get("id");
    if (!isUuid(id)) return notFound();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 400 });

    const row = await readRow(supabase, userId, id);
    if ("missingColumn" in row) return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
    if ("error" in row) {
      console.error("sent CV row read error:", row.error);
      return NextResponse.json({ error: "Could not store that file. Try again." }, { status: 500 });
    }
    if (!row.found) return notFound();

    // The kind comes from the bytes, never the name or the browser's type.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let kind: SentCvKind;
    try {
      kind = detectFileKind(bytes, file.name || "");
    } catch (err) {
      if (err instanceof CvParseError) return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
      throw err;
    }

    // The text is kept for the tracker to show; a file whose text can't be
    // read (a scanned PDF) is still kept — it is what was sent. The reader
    // gets a COPY: pdf.js takes over (detaches) the buffer it is handed, and
    // parsing `bytes` itself stored every PDF as an empty file.
    let text = "";
    let textNote = "";
    try {
      text = (await withTimeout(parseCvFile(bytes.slice(), file.name || ""), PARSE_TIMEOUT_MS)).text;
    } catch (err) {
      textNote = textNoteFor(err instanceof CvParseError ? err.code : "unreadable");
      if (!(err instanceof CvParseError)) console.warn("sent CV text read failed:", err instanceof Error ? err.message : "Unknown error");
    }

    const now = Date.now();
    const path = sentCvPath(userId, id, file.name, kind, now);
    const storage = supabase.storage.from(SENT_CV_BUCKET);
    const { error: uploadError } = await storage.upload(path, bytes, { contentType: contentTypeFor(kind), upsert: false });
    if (uploadError) {
      if (/bucket not found/i.test(uploadError.message)) return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
      console.error("sent CV upload error:", uploadError.message);
      return NextResponse.json({ error: "Could not store that file. Try again." }, { status: 500 });
    }

    const record: SentCv = {
      version: 1,
      path,
      fileName: displayFileName(file.name, kind),
      size: bytes.length,
      kind,
      uploadedAt: new Date(now).toISOString(),
      text,
      ...(textNote ? { textNote } : {}),
    };
    const { data: updated, error: updateError } = await supabase
      .from("applications")
      .update({ sent_cv: record })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (updateError || !updated || updated.length === 0) {
      // Never leave a stored file that no row points at.
      const { error: cleanupError } = await storage.remove([path]);
      if (cleanupError) console.warn("sent CV cleanup failed:", cleanupError.message);
      if (updateError && isMissingColumn(updateError)) return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
      if (!updateError) return notFound();
      console.error("sent CV record error:", updateError.message);
      return NextResponse.json({ error: "Could not store that file. Try again." }, { status: 500 });
    }

    // The file this one replaces. Best effort: a leftover sits in the user's
    // own private folder and goes when the application is deleted.
    if (row.sent && row.sent.path !== path && ownsPath(row.sent.path, userId, id)) {
      const { error: removeError } = await storage.remove([row.sent.path]);
      if (removeError) console.warn("sent CV: replaced file not removed:", removeError.message);
    }

    return NextResponse.json({ ok: true, sentCv: publicSentCv(record) });
  } catch (err) {
    console.error("sent CV POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not store that file. Try again." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await signedIn();
    if (!auth) return unauthorized();
    const { supabase, userId } = auth;
    const id = new URL(req.url).searchParams.get("id");
    if (!isUuid(id)) return notFound();

    const row = await readRow(supabase, userId, id);
    if ("error" in row) {
      console.error("sent CV row read error:", row.error);
      return NextResponse.json({ error: "Could not load that file. Try again." }, { status: 500 });
    }
    const sent = "found" in row && row.found ? row.sent : null;
    if (!sent || !ownsPath(sent.path, userId, id)) {
      return NextResponse.json({ error: "No CV file is stored for this application." }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await supabase.storage.from(SENT_CV_BUCKET).download(sent.path);
    if (downloadError || !blob) {
      console.error("sent CV download error:", downloadError?.message ?? "empty body");
      return NextResponse.json({ error: "The stored file could not be loaded. Try again." }, { status: 502 });
    }
    const body = new Uint8Array(await blob.arrayBuffer());
    // Always an attachment and never sniffed: a stored file is handed back,
    // not rendered on this origin.
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentTypeFor(sent.kind),
        "Content-Disposition": contentDisposition(sent.fileName),
        "Content-Length": String(body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("sent CV GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load that file. Try again." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await signedIn();
    if (!auth) return unauthorized();
    const { supabase, userId } = auth;
    const id = new URL(req.url).searchParams.get("id");
    if (!isUuid(id)) return notFound();

    const row = await readRow(supabase, userId, id);
    // No column yet: there is nothing stored to remove.
    if ("missingColumn" in row) return NextResponse.json({ ok: true });
    if ("error" in row) {
      console.error("sent CV row read error:", row.error);
      return NextResponse.json({ error: "Could not remove that file. Try again." }, { status: 500 });
    }
    if (!row.found) return notFound();
    if (!row.sent) return NextResponse.json({ ok: true });

    // The file first: if it can't be removed, the record stays and the user
    // can try again, rather than a file nothing points at.
    if (ownsPath(row.sent.path, userId, id)) {
      const { error: removeError } = await supabase.storage.from(SENT_CV_BUCKET).remove([row.sent.path]);
      if (removeError) {
        console.error("sent CV remove error:", removeError.message);
        return NextResponse.json({ error: "Could not remove that file. Try again." }, { status: 500 });
      }
    }
    const { error: updateError } = await supabase
      .from("applications")
      .update({ sent_cv: null })
      .eq("id", id)
      .eq("user_id", userId);
    if (updateError) {
      console.error("sent CV clear error:", updateError.message);
      return NextResponse.json({ error: "Could not remove that file. Try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("sent CV DELETE error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not remove that file. Try again." }, { status: 500 });
  }
}
