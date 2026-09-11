// Advanced customization — pool-mode project selection (pure, offline-testable).
//
// The poolProjectsPrompt step returns { selected: [{name, date, tech, bullets}] }
// (at most 2). These helpers coerce that model JSON into the exact shape the
// client's display-profile derivation and the renderers assume, the same
// boundary-normalisation philosophy as normalizeProfile in lib/profile.ts.

export type SelectedProject = {
  name: string;
  date: string;
  tech: string;
  bullets: string[];
};

const MAX_SELECTED = 2;
const MAX_NAME = 300;
const MAX_DATE = 60;
const MAX_TECH = 500;
const MAX_BULLETS = 4;
const MAX_BULLET = 600;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// Coerce the raw model JSON. Drops nameless or bullet-less entries (a project
// with no bullets would render as a bare title), caps everything, and strips
// " | " from names — the client joins "name | date" and splitTrailingDate
// re-splits on the LAST separator, so a separator inside the name would split
// in the wrong place.
export function normalizeSelectedProjects(raw: unknown): SelectedProject[] {
  const selected =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).selected
      : null;
  if (!Array.isArray(selected)) return [];

  const out: SelectedProject[] = [];
  for (const entry of selected) {
    if (out.length >= MAX_SELECTED) break;
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const name = str(o.name, MAX_NAME).replace(/\s*\|\s*/g, " – ");
    const bullets = Array.isArray(o.bullets)
      ? o.bullets
          .map((b) => str(b, MAX_BULLET).replace(/^[-•·*]\s*/, ""))
          .filter(Boolean)
          .slice(0, MAX_BULLETS)
      : [];
    if (!name || bullets.length === 0) continue;
    out.push({ name, date: str(o.date, MAX_DATE), tech: str(o.tech, MAX_TECH), bullets });
  }
  return out;
}

// The renderers key bullets by project index, in selection order.
export function projectsFromSelected(sel: SelectedProject[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  sel.forEach((p, i) => {
    out[String(i)] = p.bullets;
  });
  return out;
}
