// The CV file a user actually sent for one application — typically one made
// outside Jobhuntz (another site's form, an agency, an email) — uploaded on
// /applications and kept in the private Storage bucket "application-cvs"
// (migration 20260927120000_application_cvs.sql).
//
// Stored on the row as applications.sent_cv:
//   { version: 1, path, fileName, size, kind, uploadedAt, text, textNote? }
// `path` is "<user id>/<application id>/<timestamp>-<safe name>": the
// bucket's policies let a signed-in user reach only their own folder, and
// /api/applications/cv checks the prefix again before every read. `text` is
// what lib/parseCv read out of the file (empty with a `textNote` when it
// could not — a scanned PDF keeps its file, it just has no text to show).
// The path never leaves the server: the client sees SentCvInfo.
//
// Import-free (tests/sentCv.test.ts).

export const SENT_CV_BUCKET = "application-cvs";
export const MAX_SENT_CV_TEXT = 20_000;

export type SentCvKind = "pdf" | "docx" | "txt";
export type SentCv = {
  version: 1;
  path: string;
  fileName: string;
  size: number;
  kind: SentCvKind;
  uploadedAt: string;
  text: string;
  textNote?: string;
};
export type SentCvInfo = Omit<SentCv, "version" | "path">;

const CONTENT_TYPES: Record<SentCvKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};
const EXTENSIONS: Record<SentCvKind, string> = { pdf: ".pdf", docx: ".docx", txt: ".txt" };

export function contentTypeFor(kind: SentCvKind): string {
  return CONTENT_TYPES[kind];
}

function isKind(v: unknown): v is SentCvKind {
  return v === "pdf" || v === "docx" || v === "txt";
}

// The name shown in the tracker and given back on download: the user's own
// file name, without control characters or path separators, bounded, ending
// in the extension its content really has.
export function displayFileName(name: unknown, kind: SentCvKind): string {
  const base = (typeof name === "string" ? name : "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim()
    .replace(/\.(pdf|docx?|txt)$/i, "")
    .trim()
    .slice(0, 120);
  return (base || "CV") + EXTENSIONS[kind];
}

// The object's name in storage: letters, digits, dot, dash and underscore
// only — a storage key is not the place for spaces or accents.
export function storageFileName(name: unknown, kind: SentCvKind): string {
  const shown = displayFileName(name, kind);
  const base = shown
    .slice(0, shown.length - EXTENSIONS[kind].length)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return (base || "cv") + EXTENSIONS[kind];
}

export function sentCvPath(userId: string, applicationId: string, name: unknown, kind: SentCvKind, now: number): string {
  return `${userId}/${applicationId}/${now}-${storageFileName(name, kind)}`;
}

// A stored path this user may touch for this application: inside their own
// folder, never climbing out of it.
export function ownsPath(path: unknown, userId: string, applicationId: string): path is string {
  return (
    typeof path === "string" &&
    path.length <= 400 &&
    path.startsWith(`${userId}/${applicationId}/`) &&
    !path.split("/").some((part) => part === ".." || part === ".")
  );
}

// Content-Disposition for the download: an ASCII fallback name plus the
// exact UTF-8 name (RFC 6266 / 5987), always as an attachment.
export function contentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// Why a kept file has no text to show (lib/parseCv error codes).
export function textNoteFor(code: string): string {
  switch (code) {
    case "no_text_layer":
      return "This PDF has no text layer (it looks like a scanned image), so recruiters' systems read nothing from it either. The file is kept.";
    case "empty":
      return "No text was found in this file. The file is kept.";
    case "too_long":
      return "The file's text is too long to show here. The file is kept.";
    case "timeout":
      return "Reading the text took too long, so it isn't shown. The file is kept.";
    default:
      return "The text couldn't be read from this file. The file is kept.";
  }
}

// sent_cv as read back. A user can write their own row under RLS, so the
// stored value is bounded again rather than trusted.
export function normalizeSentCv(v: unknown): SentCv | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isKind(o.kind) || typeof o.path !== "string" || !o.path) return null;
  const size = typeof o.size === "number" && Number.isFinite(o.size) && o.size >= 0 ? Math.round(o.size) : 0;
  const uploadedAt = typeof o.uploadedAt === "string" && !Number.isNaN(Date.parse(o.uploadedAt)) ? o.uploadedAt : "";
  const note = typeof o.textNote === "string" ? o.textNote.trim().slice(0, 300) : "";
  return {
    version: 1,
    path: o.path.slice(0, 400),
    fileName: displayFileName(o.fileName, o.kind),
    size,
    kind: o.kind,
    uploadedAt,
    text: typeof o.text === "string" ? o.text.slice(0, MAX_SENT_CV_TEXT) : "",
    ...(note ? { textNote: note } : {}),
  };
}

// What the client is given: everything but the storage path.
export function publicSentCv(s: SentCv | null): SentCvInfo | null {
  if (!s) return null;
  const { version: _v, path: _p, ...rest } = s;
  void _v;
  void _p;
  return rest;
}

// "212 KB" / "1.4 MB" for the tracker.
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
