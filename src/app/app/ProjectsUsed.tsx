"use client";

// Which pool projects a run used and why, with a way to change one (4 Nov 2026, Chunk 14).
// "Jobhuntz (pinned) · CampaignPulse (matches: AWS, event-driven, tests)". A swap re-runs
// the projects section only.
import type { PoolCard } from "@/lib/projectPool";

export type ProjectUsed = { cardId: string; name: string; pinned: boolean; matches: string[] };

const MAX_MATCHES_SHOWN = 4;

function why(p: ProjectUsed): string {
  if (p.pinned) return " (pinned)";
  return p.matches.length > 0 ? ` (matches: ${p.matches.slice(0, MAX_MATCHES_SHOWN).join(", ")})` : "";
}

export default function ProjectsUsed({
  used, cards, busy, error, note, onSwap,
}: {
  used: readonly ProjectUsed[];
  cards: readonly PoolCard[];
  busy: boolean;
  error: string;
  note: string;
  onSwap: (index: number, cardId: string) => void;
}) {
  const inUse = new Set(used.map((p) => p.cardId));
  const others = cards.filter((c) => !inUse.has(c.id));
  return (
    <div className="projectsUsed" data-projects-used>
      <span className="label">Projects used</span>
      <ul className="projectsUsedList">
        {used.map((p, i) => (
          <li key={p.cardId} data-project-used={p.cardId}>
            <span><strong>{p.name}</strong>{why(p)}</span>
            {others.length > 0 && (
              <select
                className="appsToolSelect projectsUsedSwap"
                aria-label={`Swap ${p.name} for another project`}
                value=""
                disabled={busy}
                onChange={(e) => { if (e.target.value) onSwap(i, e.target.value); }}
                data-project-swap={p.cardId}
              >
                <option value="">{busy ? "Swapping…" : "Swap"}</option>
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="statusText" role="alert" data-project-swap-error>{error}</p>}
      {note && <p className="fitEvidence" role="status" data-project-swap-note>{note}</p>}
    </div>
  );
}
