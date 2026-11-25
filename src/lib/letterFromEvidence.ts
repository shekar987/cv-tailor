// letterFromEvidence.ts — import-free
//
// A free, deterministic cover letter builder that uses only the user's own
// CV evidence. No AI call. No credit spent.
//
// Every sentence in the output is tagged with its source (template, evidence,
// user_provided, rtw) so the caller can verify that nothing was invented.

// ── Types ─────────────────────────────────────────────────────────────────────

export type EvidenceSource = {
  id: string;        // e.g. "R1.1"
  bulletText: string; // verbatim bullet text from the master CV
  roleTitle: string;  // from the role header, e.g. "Full Stack Engineer"
  employer: string;   // from the role header, e.g. "Acme Corp"
};

export type SentenceRecord = {
  text: string;
  kind: "template" | "evidence" | "user_provided" | "rtw";
  evidenceId?: string;
};

export type LetterFromEvidenceInput = {
  profileName: string;
  roleTitle: string;      // role being applied for
  companyName: string;    // company being applied to
  evidence: EvidenceSource[];  // 2-3 items, pre-sourced from the master CV
  cvText: string;         // full master CV text — used for invention check
  whyCompany?: string | null;
  rtwStatement?: string | null;
  template?: "corporate" | "founder";
};

export type LetterFromEvidenceResult = {
  letter: string;
  sentences: SentenceRecord[];
  rejectedIds: string[];  // evidence IDs whose bullet text failed the CV check
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "in", "of", "to", "at", "for", "with",
  "from", "by", "on", "is", "it", "was", "i", "we", "our", "my", "be",
  "been", "have", "had", "has", "that", "this", "are", "were", "do", "did",
  "if", "but", "not", "so", "up", "out", "about", "than", "after", "before",
]);

// ── bulletInCv ────────────────────────────────────────────────────────────────

/**
 * Returns true if ≥60% of the content words (length > 2, not in STOPWORDS)
 * of `bulletText` appear in `cvText` (case-insensitive).
 * Returns true for very short bullets (< 2 content words) — too short to validate.
 */
export function bulletInCv(bulletText: string, cvText: string): boolean {
  const cvLower = cvText.toLowerCase();

  const contentWords = bulletText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (contentWords.length < 2) return true;

  let matches = 0;
  for (const word of contentWords) {
    if (cvLower.includes(word)) matches++;
  }

  return matches / contentWords.length >= 0.6;
}

// ── bulletToFirstPerson ───────────────────────────────────────────────────────

/**
 * Converts a bullet text to a first-person sentence.
 * "• Built REST APIs serving 50,000 users" → "I built REST APIs serving 50,000 users."
 */
export function bulletToFirstPerson(bulletText: string): string {
  // Strip bullet glyphs and leading whitespace
  let text = bulletText.replace(/^\s*[•\-*]\s+/, "").trim();

  // Lowercase first character
  if (text.length > 0) {
    text = text[0].toLowerCase() + text.slice(1);
  }

  // Prepend "I "
  text = `I ${text}`;

  // Ensure it ends with a period
  if (!text.endsWith(".")) {
    text = `${text}.`;
  }

  return text;
}

// ── buildLetterFromEvidence ───────────────────────────────────────────────────

/**
 * Builds a cover letter from the user's own CV evidence only.
 * Every sentence is tagged with its source kind.
 * Evidence bullets that fail the CV check are added to rejectedIds and skipped.
 */
export function buildLetterFromEvidence(
  input: LetterFromEvidenceInput,
): LetterFromEvidenceResult {
  const {
    profileName,
    roleTitle,
    companyName,
    evidence,
    cvText,
    whyCompany,
    rtwStatement,
    template = "corporate",
  } = input;

  const rejectedIds: string[] = [];
  const validEvidence: EvidenceSource[] = [];

  // Step 1: check each evidence bullet against the CV
  for (const ev of evidence) {
    if (bulletInCv(ev.bulletText, cvText)) {
      validEvidence.push(ev);
    } else {
      rejectedIds.push(ev.id);
    }
  }

  const sentences: SentenceRecord[] = [];
  const paragraphs: string[] = [];

  if (template === "founder") {
    // ── Founder template: concise, 4-6 non-empty lines ─────────────────────

    // Salutation
    const dearLine = `Dear ${companyName} team,`;
    sentences.push({ text: dearLine, kind: "template" });
    paragraphs.push(dearLine);

    // Application line
    const applyLine = `I am applying for the ${roleTitle} role.`;
    sentences.push({ text: applyLine, kind: "template" });
    paragraphs.push(applyLine);

    // Up to 2 evidence bullets
    for (const ev of validEvidence.slice(0, 2)) {
      const sent = bulletToFirstPerson(ev.bulletText);
      sentences.push({ text: sent, kind: "evidence", evidenceId: ev.id });
      paragraphs.push(sent);
    }

    // RTW if provided
    if (rtwStatement && rtwStatement.trim()) {
      sentences.push({ text: rtwStatement, kind: "rtw" });
      paragraphs.push(rtwStatement);
    }

    // Sign-off
    const regards = "Kind regards,";
    const name = profileName;
    sentences.push({ text: regards, kind: "template" });
    sentences.push({ text: name, kind: "template" });
    paragraphs.push(`${regards}\n${name}`);
  } else {
    // ── Corporate template ─────────────────────────────────────────────────

    // Salutation
    const dearLine = `Dear ${companyName} team,`;
    sentences.push({ text: dearLine, kind: "template" });
    paragraphs.push(dearLine);

    // Opening paragraph: role application
    const applyLine = `I am applying for the ${roleTitle} role at ${companyName}.`;
    sentences.push({ text: applyLine, kind: "template" });
    paragraphs.push(applyLine);

    // Evidence paragraph: each valid evidence bullet as a first-person sentence
    if (validEvidence.length > 0) {
      const evidenceLines: string[] = [];
      for (const ev of validEvidence.slice(0, 3)) {
        const sent = `At ${ev.employer}, ${bulletToFirstPerson(ev.bulletText)}`;
        sentences.push({ text: sent, kind: "evidence", evidenceId: ev.id });
        evidenceLines.push(sent);
      }
      paragraphs.push(evidenceLines.join(" "));
    }

    // Optional whyCompany paragraph
    if (whyCompany && whyCompany.trim()) {
      sentences.push({ text: whyCompany.trim(), kind: "user_provided" });
      paragraphs.push(whyCompany.trim());
    }

    // Optional RTW statement
    if (rtwStatement && rtwStatement.trim()) {
      sentences.push({ text: rtwStatement, kind: "rtw" });
      paragraphs.push(rtwStatement);
    }

    // Closing paragraph
    const closingLine = "I would welcome the opportunity to discuss my application further.";
    sentences.push({ text: closingLine, kind: "template" });
    paragraphs.push(closingLine);

    // Sign-off
    const regards = "Kind regards,";
    const name = profileName;
    sentences.push({ text: regards, kind: "template" });
    sentences.push({ text: name, kind: "template" });
    paragraphs.push(`${regards}\n${name}`);
  }

  const letter = paragraphs.join("\n\n");

  return { letter, sentences, rejectedIds };
}
