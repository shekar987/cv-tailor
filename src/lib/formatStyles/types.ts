// One FormatStyle object per style (./ukji.ts, ./careerset.ts): the style's
// rules (./ids.ts STYLE_RULES — limits, skills shape, lint, renderer options,
// letter furniture) plus the prompt blocks only the server needs, so the
// tailor route reads a field instead of branching on the id.
import type { StyleRules } from "./ids.ts";

export type SummaryFormCtx = {
  // The app will append its own availability sentence to the summary, so the
  // model is asked for one sentence fewer.
  availabilityAppended: boolean;
};

// The letter prompt's shape, shared by both styles' functions. pointsBlock:
// the requirements the letter may build its numbered points on (CareerSet;
// ignored by UKJI's prompt).
export type LetterPromptFn = (cv: string, claimsBlock?: string, omitRightToWork?: boolean, evidenceBlock?: string, pointsBlock?: string) => string;

export type FormatStyle = StyleRules & {
  // The passages of the writing prompts that differ by style (prompts/steps.ts
  // takes each as a parameter beside variantBlock / evidenceBlock).
  prompts: {
    summaryForm: (ctx: SummaryFormCtx) => string;
    skillsShape: string;
    verbRule: string;
    experienceFormat: string;
    projectsBullets: string;
    poolBullets: string;
    coverLetter: LetterPromptFn;
  };
};
