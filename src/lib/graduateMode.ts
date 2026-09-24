// Graduate-scheme layout. A graduate / placement / early-careers posting is
// screened on the degree first, so for that run Education moves up to sit
// right under the summary; everything else keeps the user's own order. The
// read is deterministic (title words, or the posting naming a graduate
// scheme / programme), the change is per run, and the user can switch the
// run back to their standard order with one click on /app.
//
// Imports only ./sectionOrder.ts so it runs under node:test.
import { resolveSectionOrder, type SectionId } from "./sectionOrder.ts";

const GRADUATE_TITLE_RE =
  /\b(?:graduate|graduates|placement|intern|internship|entry[-\s]level|early[-\s]careers?|apprentice(?:ship)?|trainee|new\s+grad)\b/i;
const GRADUATE_JD_RE =
  /\b(?:graduate|early[-\s]careers?)\s+(?:scheme|programme|program|rotation(?:al)?\s+programme|rotation(?:al)?\s+program|development\s+programme|development\s+program)\b|\b(?:placement|industrial placement|year in industry|sandwich)\s+(?:year|student|role)\b/i;

export function isGraduateScheme(roleTitle: unknown, jd: string = ""): boolean {
  if (typeof roleTitle === "string" && GRADUATE_TITLE_RE.test(roleTitle)) return true;
  return GRADUATE_JD_RE.test(jd);
}

// The run's order: Education directly after the summary (or first when the
// order has no summary) unless the user already lists it before Experience.
export function graduateSectionOrder(stored: unknown): { order: SectionId[]; changed: boolean } {
  const base = resolveSectionOrder(stored);
  const edu = base.indexOf("education");
  const exp = base.indexOf("experience");
  if (edu === -1 || (exp !== -1 && edu < exp)) return { order: base, changed: false };
  const without = base.filter((s) => s !== "education");
  const at = without[0] === "summary" ? 1 : 0;
  const order = [...without.slice(0, at), "education" as SectionId, ...without.slice(at)];
  return { order, changed: order.join() !== base.join() };
}
