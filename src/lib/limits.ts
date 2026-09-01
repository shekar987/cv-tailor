// Input size limits shared by the API routes and the pages that pre-check
// them. One definition so the client counter, the route guard and the parser
// can never disagree.

export const MAX_JD_CHARS = 15_000;
export const MAX_CV_CHARS = 20_000;
export const MAX_COVER_LETTER_CHARS = 10_000;
export const MAX_NOTES_CHARS = 2_000;
export const MAX_FEEDBACK_CHARS = 2_000;

// The four document routes take the whole preview in one JSON body. A real
// CV payload is a few tens of KB; anything past this is not a document.
export const MAX_DOCUMENT_BODY_BYTES = 512 * 1024;

// Free-tier quotas — enforced by /api/tailor's SECURITY DEFINER RPCs and
// displayed by the usage chip (/app), the account card (/settings) and the
// landing page. One definition so the UI can never promise a different
// number than the server enforces.
export const DAILY_TAILOR_LIMIT = 3;
export const CLAUDE_LIFETIME_LIMIT = 3;

export const JD_TOO_LONG = "Job description is too long (max ~15,000 characters).";
export const CV_TOO_LONG = "CV is too long (max ~5 pages / 20,000 characters).";
