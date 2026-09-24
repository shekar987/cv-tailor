// Role-targeted CV variants (Brief 3, part 3). A variant is NOT a second
// document: it is a small set of positioning rules applied to the one master
// CV and the one claims registry - a headline (one positioning per CV), the
// skills to lead with, and the role types it is meant for. Tailoring picks
// the variant whose role types include the analysis's role_type, says which
// it chose and why, and the user can override for that run. Imports only
// ./atsMatch.ts (lead skills are checked against the claims registry with
// the same matcher that scores the CV); unit-tested.
import { matchAtsKeywords } from "./atsMatch.ts";

export const ROLE_TYPES = ["backend", "frontend", "fullstack", "ai_engineering", "data_engineering", "ml_engineering", "devops", "other"] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export type Variant = {
  id: string;
  name: string;
  // The one positioning the summary opens with, e.g. "Backend engineer (Java, Spring Boot)".
  headline: string;
  roleTypes: RoleType[];
  // Skills to list first when the CV genuinely has them.
  leadSkills: string[];
};
export type VariantsConfig = { version: 1; variants: Variant[] };

export const MAX_VARIANTS = 6;
export const MAX_LEAD_SKILLS = 12;

// A variant's lead skills are the first things a recruiter reads, so only a
// skill the claims registry holds at PRODUCTION level may lead. A project or
// learning skill is skipped (and named), and so is a skill the registry does
// not know — the registry is the candidate's own statement of what each
// skill can be called. With no registry there is nothing to check against.
export type LeadSkillDrop = { skill: string; reason: "project" | "learning" | "unregistered" };
export function productionLeadSkills(
  leadSkills: string[],
  claims: { skills: { name: string; level: string }[] } | null | undefined
): { kept: string[]; dropped: LeadSkillDrop[] } {
  if (!claims || claims.skills.length === 0) return { kept: [...leadSkills], dropped: [] };
  const kept: string[] = [];
  const dropped: LeadSkillDrop[] = [];
  for (const skill of leadSkills) {
    const matches = claims.skills.filter(
      (s) => matchAtsKeywords(s.name, [skill]).matched > 0 || matchAtsKeywords(skill, [s.name]).matched > 0
    );
    if (matches.some((s) => s.level === "production")) kept.push(skill);
    else if (matches.length === 0) dropped.push({ skill, reason: "unregistered" });
    else dropped.push({ skill, reason: matches.some((s) => s.level === "project") ? "project" : "learning" });
  }
  return { kept, dropped };
}

export function leadSkillsNotice(dropped: LeadSkillDrop[]): string {
  if (dropped.length === 0) return "";
  const word = (r: LeadSkillDrop["reason"]) => (r === "project" ? "project-level" : r === "learning" ? "still being learned" : "not on your claims registry");
  return `Only production-level skills can lead. Skipped: ${dropped.map((d) => `${d.skill} (${word(d.reason)})`).join(", ")}.`;
}

export const ROLE_TYPE_LABEL: Record<RoleType, string> = {
  backend: "Backend",
  frontend: "Frontend",
  fullstack: "Full stack",
  ai_engineering: "AI engineering",
  data_engineering: "Data engineering",
  ml_engineering: "ML engineering",
  devops: "DevOps / platform",
  other: "Other",
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function strList(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function newVariantId(): string {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeVariants(v: unknown): VariantsConfig | null {
  const c = obj(v);
  if (!Array.isArray(c.variants)) return null;
  const variants: Variant[] = [];
  const ids = new Set<string>();
  for (const raw of c.variants) {
    const r = obj(raw);
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 60) : "";
    if (!name) continue;
    let id = typeof r.id === "string" && /^[\w-]{1,32}$/.test(r.id) ? r.id : newVariantId();
    while (ids.has(id)) id = newVariantId();
    ids.add(id);
    variants.push({
      id,
      name,
      headline: typeof r.headline === "string" ? r.headline.trim().replace(/\s+/g, " ").slice(0, 120) : "",
      roleTypes: strList(r.roleTypes, ROLE_TYPES.length, 20).filter((t): t is RoleType => (ROLE_TYPES as readonly string[]).includes(t)),
      leadSkills: strList(r.leadSkills, MAX_LEAD_SKILLS, 40),
    });
    if (variants.length >= MAX_VARIANTS) break;
  }
  return { version: 1, variants };
}

export type VariantPick = { variant: Variant | null; reason: string; source: "override" | "role_type" | "single" | "none" };

// Which variant applies to this run. An explicit override wins; otherwise
// the first variant whose role types include the analysis's role_type; a
// lone variant with no role types applies to everything; else none.
export function pickVariant(config: VariantsConfig | null | undefined, roleType: unknown, overrideId?: string | null): VariantPick {
  const variants = config?.variants ?? [];
  if (variants.length === 0) return { variant: null, reason: "No positioning variants saved.", source: "none" };
  if (overrideId === "none") return { variant: null, reason: "No variant applied (your choice for this run).", source: "override" };
  if (overrideId) {
    const v = variants.find((x) => x.id === overrideId);
    if (v) return { variant: v, reason: `${v.name} (your choice for this run).`, source: "override" };
  }
  const rt = typeof roleType === "string" ? roleType : "";
  const byRole = rt ? variants.find((v) => v.roleTypes.includes(rt as RoleType)) : undefined;
  if (byRole) return { variant: byRole, reason: `${byRole.name} - the posting reads as ${ROLE_TYPE_LABEL[rt as RoleType] ?? rt}.`, source: "role_type" };
  if (variants.length === 1 && variants[0].roleTypes.length === 0)
    return { variant: variants[0], reason: `${variants[0].name} - your only variant, set for every role type.`, source: "single" };
  return {
    variant: null,
    reason: rt ? `None of your variants is set for a ${ROLE_TYPE_LABEL[rt as RoleType] ?? rt} role - tailoring uses your CV's own positioning.` : "The posting's role type wasn't read - tailoring uses your CV's own positioning.",
    source: "none",
  };
}

// Prompt text for the summary and skills steps. Bounded by the honesty
// rules like everything else: a lead skill the CV lacks is simply not listed.
export function renderVariantBlock(variant: Variant | null | undefined): string {
  if (!variant) return "";
  const lines = [`POSITIONING (the candidate's own choice for this kind of role - "${variant.name}"):`];
  if (variant.headline) lines.push(`- The summary's first line positions the candidate as: ${variant.headline}. One positioning only - never a second role joined by a slash or a pipe.`);
  if (variant.leadSkills.length) lines.push(`- List these first, in this order, when the master CV genuinely shows them (skip any it does not): ${variant.leadSkills.join(", ")}.`);
  return lines.join("\n");
}
