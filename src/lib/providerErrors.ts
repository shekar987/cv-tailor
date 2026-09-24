// Is this provider failure "the account has run out of credit"?
//
// Split out of lib/claude.ts purely so it is testable: that module constructs
// the Anthropic SDK and throws at import time without the env vars, so nothing
// in it can be reached from node:test. Import-free on purpose.
//
// WHY IT EXISTS: on 2026-09-24 the owner's Anthropic balance hit zero and every
// tailor on production returned a bare 500 "Tailoring failed" — nothing told
// the user it wasn't their fault, and nothing pointed at the answer the app
// already has (their own free OpenRouter key). Anthropic reports an exhausted
// balance as a 400 `invalid_request_error`, which otherwise reads as "we sent a
// malformed request".
//
// Deliberately NARROW. A provider 400 is normally our own bug, and telling
// someone to go buy credit they don't need is worse than a generic error — so
// only an explicit billing phrase, or a 402, counts.

const BILLING_RE =
  /credit balance is too low|insufficient (?:credit|funds|balance|quota)|billing|payment required|exceeded your current quota/i;

export function looksLikeBilling(status: number | undefined, text: string): boolean {
  if (status === 402) return true;
  if (status !== undefined && status !== 400 && status !== 403) return false;
  return BILLING_RE.test(text || "");
}
