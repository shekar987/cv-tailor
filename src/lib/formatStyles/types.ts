// One FormatStyle object per style (./ukji.ts, ./careerset.ts): everything
// the tailor route varies by style, so the route reads a field instead of
// branching on the id. Server-side only (the prompt blocks ride in it).
import type { FormatStyleId, RenderOptions, SkillsShape } from "./ids.ts";

export type SummaryFormCtx = {
  // The app will append its own availability sentence to the summary, so the
  // model is asked for one sentence fewer.
  availabilityAppended: boolean;
};

// The letter prompt's shape, shared by both styles' functions. pointsBlock:
// the requirements the letter may build its numbered points on (CareerSet;
// ignored by UKJI's prompt).
export type LetterPromptFn = (cv: string, claimsBlock?: string, omitRightToWork?: boolean, evidenceBlock?: string, pointsBlock?: string) => string;

export type FormatStyle = {
  id: FormatStyleId;
  label: string;
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
  limits: {
    summary: { maxSentences: number; maxWords: number };
    competencies: { max: number };
    tools: { max: number; leadSlots: number };
    bullets: {
      maxWords: number | null;
      maxLines: number;
      // Across experience AND projects; null = no total cap (the page fit decides).
      total: { min: number; max: number } | null;
      perProject: { min: number; max: number };
    };
    cv: { maxWords: number | null };
    letter: { minWords: number; maxWords: number };
  };
  skills: SkillsShape;
  lint: {
    // Words a bullet may not carry (whole words / phrases, case-insensitive).
    bannedWords: readonly string[];
    // A banned word → the plain words it may become, in order of preference,
    // "" meaning "drop the word". A banned word with no entry is only ever
    // reported: no automatic swap may claim more than the master CV.
    equivalences: Readonly<Record<string, readonly string[]>>;
    // How many bullets across the CV may open with the same verb; null = no cap.
    verbCap: number | null;
    letterBanned: readonly string[];
  };
  render: RenderOptions;
  summary: {
    // Append the Eligibility availability sentence (CV voice) as the last
    // sentence, when the answer is given.
    appendAvailability: boolean;
  };
  letter: {
    // Sentences the fact check never judges (the style's fixed lines).
    furniture: readonly RegExp[];
    interestOpening: string | null;
    fixedLine: string | null;
    thanksLine: string;
    points: number;
    // "Dear <Company> team," (UKJI) vs "Dear <Company> Hiring Team," (CareerSet).
    teamSuffix: string;
    // Where the right-to-work statement goes: its own paragraph above the
    // sign-off, or the start of the close paragraph (the one with the thanks).
    statementPlacement: "own_paragraph" | "close_paragraph";
    // Remove a bare "N." line a removal left behind and renumber the points.
    renumberPoints: boolean;
  };
};
