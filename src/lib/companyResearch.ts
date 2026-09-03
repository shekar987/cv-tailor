// Stage 3: the sanitizer for client-forwarded company research, shared by
// /api/tailor (prompt injection) and /api/extras (pitch script, talking
// points). Client-supplied data never enters a prompt verbatim — this
// REBUILDS the object from typed, size-capped fields. Returns null (research
// ignored) unless it carries at least a company name or product line.

const MAX_RESEARCH_CHARS = 6_000;

export function sanitizeCompanyResearch(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const take = (x: unknown, max = 400) => (typeof x === "string" && x.trim() ? x.slice(0, max) : undefined);
  const takeList = (x: unknown, count: number, each = 120) =>
    Array.isArray(x)
      ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, count).map((s) => s.slice(0, each))
      : undefined;
  const out: Record<string, unknown> = {};
  const name = take(r.company_name, 120);
  if (name) out.company_name = name;
  const build = take(r.what_they_build);
  if (build) out.what_they_build = build;
  const audience = take(r.target_audience, 120);
  if (audience) out.target_audience = audience;
  const ai = take(r.ai_footprint);
  if (ai) out.ai_footprint = ai;
  const pains = takeList(r.pain_points, 5, 200);
  if (pains?.length) out.pain_points = pains;
  const stack = takeList(r.engineering_stack, 25);
  if (stack?.length) out.engineering_stack = stack;
  const tone = takeList(r.tone_words, 6, 40);
  if (tone?.length) out.tone_words = tone;
  if (!out.company_name && !out.what_they_build) return null;
  return JSON.stringify(out).length <= MAX_RESEARCH_CHARS ? out : null;
}
