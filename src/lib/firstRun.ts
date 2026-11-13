// The first-run flow (12 Nov 2026, Chunk 24): what a new account is asked to do
// first, in order, and what the empty screens hide until there is something to
// show. Import-free, so it runs under node:test.
//
// Three steps: upload a master CV, answer right to work and sponsorship, paste
// a first job. The second is the user's own explicit choice, always: nothing
// here reads the CV or picks an answer for them (lib/knockouts never infers an
// Eligibility answer either). Skipping it leaves "unknown", which every form
// answer and gate reads as "not set".

export type RtwStatus = "full" | "time_limited" | "needs_sponsorship" | "unknown";

export type FirstRunFacts = {
  // A master CV with text is saved (master_cvs.text not empty).
  hasCv: boolean;
  rtwStatus: RtwStatus;
  // Every tracker row the account holds, any status.
  applicationCount: number;
};

export type FirstRunStep = "cv" | "rtw" | "job";

/** The step a user is on, or null once all three are done. */
export function firstRunStep(f: FirstRunFacts): FirstRunStep | null {
  if (!f.hasCv) return "cv";
  if (f.rtwStatus === "unknown") return "rtw";
  if (f.applicationCount === 0) return "job";
  return null;
}

/**
 * How a page shows the flow. "guide" is the whole checklist, for an account
 * with no application yet; "banner" is the one first step for an account that
 * has applications but no CV (a tracker kept by hand or by an automation),
 * since nothing can be tailored without one; null is nothing at all. An
 * established account that never answered right to work is not nagged here:
 * its form answers already say "Not answered on Customise".
 */
export function firstRunMode(f: FirstRunFacts | null): "guide" | "banner" | null {
  if (!f) return null;
  if (firstRunStep(f) === null) return null;
  if (f.applicationCount === 0) return "guide";
  return f.hasCv ? null : "banner";
}

/** What Next's calendar, Clashes and Pipeline would show for an account with nothing in them. */
export function planRailIsEmpty(applicationCount: number, eventCount: number): boolean {
  return applicationCount === 0 && eventCount === 0;
}

// The stage history began on this day (migration 20261103120000): a row made
// before it shows only its current stage, and an earlier rejection counts at
// Applied. An account created on or after it has no such row, so the caveat
// says nothing true about its pipeline.
export const STAGES_RECORDED_FROM = "2026-11-03";

/** Whether the "Stages are recorded from 3 Nov 2026" caveat applies to this account. */
export function showsStagesCaveat(accountCreatedAt: string | null | undefined): boolean {
  const ms = typeof accountCreatedAt === "string" ? Date.parse(accountCreatedAt) : NaN;
  // Unknown: keep the caveat, which is only ever an understatement.
  if (!Number.isFinite(ms)) return true;
  return ms < Date.parse(`${STAGES_RECORDED_FROM}T00:00:00Z`);
}

// The three explicit answers, in the words a form uses. Each is a whole answer
// to "do you need sponsorship, now or later?"; none is pre-selected.
export const RTW_CHOICES: readonly { status: Exclude<RtwStatus, "unknown">; label: string; detail: string }[] = [
  {
    status: "full",
    label: "Permanent right to work",
    detail: "Settled status, indefinite leave to remain or citizenship. No sponsorship, now or later.",
  },
  {
    status: "time_limited",
    label: "Time-limited visa",
    detail: "A Student, Graduate or similar visa. You can start without sponsorship (an employer supporting your visa), but you will need it later.",
  },
  {
    status: "needs_sponsorship",
    label: "I need sponsorship",
    detail: "You need an employer to sponsor a visa before you can start.",
  },
];

export function rtwChoiceLabel(status: RtwStatus): string {
  return RTW_CHOICES.find((c) => c.status === status)?.label ?? "Not set";
}

/**
 * The saved Eligibility with only the right-to-work answer changed. Every
 * other answer is kept exactly as saved, including ones a page holds as an
 * unsaved draft: those are the user's to save, never this click's.
 */
export function withRightToWork<E extends { rightToWork: { status: RtwStatus; countries: string[]; permissionEnds: string | null } }>(
  saved: E,
  status: Exclude<RtwStatus, "unknown">
): E {
  return { ...saved, rightToWork: { ...saved.rightToWork, status } };
}
