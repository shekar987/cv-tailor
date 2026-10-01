// The cover letter's shape, in code (30 Sep audit, Phase 2). Three things
// the prompt asks for and the letters kept doing:
// - the second person about the reader's needs ("… that prepares you for
//   the role", "your team needs someone who …"): relevance narration in a
//   different grammar — the sentence goes;
// - the posting restated back to the reader ("Your job builds …", "You are
//   looking for …"): the reader wrote it — the sentence goes;
// - the honest gap: when the posting's essential requirement is absent from
//   the master CV, one plain sentence should say so ("I have not yet worked
//   with exchange market data or options pricing, and I would expect to
//   learn that domain from your team.") — reported, never invented.
// The opening sentence (the role by name) is never removed. Import-free.

export type LetterLint = { secondPerson: string[]; restatedJd: string[] };

const SECOND_PERSON_RE =
  /\b(?:prepares?|prepared|equips?|equipped|positions?|positioned|gives?|offers?|brings?|allows?|helps?|enables?|makes?|sets?)\s+(?:me\s+)?(?:up\s+)?(?:for\s+)?you\b|\byou(?:r\s+(?:team|company|organi[sz]ation|business|role|platform|product|customers|clients|engineers|stack))?\s+(?:need|needs|require|requires|want|wants|will\s+(?:get|find|have|benefit)|would\s+(?:get|find|have|benefit)|can\s+(?:rely|count|expect)|are\s+looking\s+for|is\s+looking\s+for|deserve|deserves)\b|\bwhat\s+you(?:'re|\s+are)\s+(?:looking\s+for|after|seeking)\b/i;
const RESTATES_JD_RE =
  /^(?:your|the)\s+(?:job\s+description|job\s+(?:posting|advert|listing|spec|specification)|job|role|posting|advert|advertisement|description|listing|vacancy|opening|position|team)\s+(?:builds?|involves?|requires?|asks?|mentions?|says?|states?|describes?|calls?|needs?|is|will|focuses|seeks?|emphasi[sz]es?|lists?)\b|^you(?:'re|\s+are)\s+(?:looking\s+for|hiring|seeking|after|building|recruiting)\b|\bas\s+(?:the|your)\s+(?:posting|job\s+description|advert|listing)\s+(?:says|states|mentions|notes|describes|makes\s+clear)\b/i;
const HONEST_GAP_RE =
  /\bI\s+(?:have\s+not|haven't|haven’t|have\s+never|do\s+not\s+yet\s+have|don't\s+yet\s+have|have\s+no)\s+(?:yet\s+)?(?:worked\s+(?:with|on|in)|used|built|had|done|direct\s+experience|experience|hands-on\s+experience|delivered|shipped|run|managed)\b|\bI\s+would\s+(?:expect|need|have)\s+to\s+learn\b|\bnot\s+(?:something|a\s+technology|a\s+domain|an\s+area)\s+I\s+have\s+(?:worked|used)\b/i;

const SALUTATION_RE = /^dear\b/i;
const SIGNOFF_RE = /^(?:kind|best|warm|warmest)\s+regards,?$|^regards,?$|^yours\s+(?:sincerely|faithfully|truly),?$|^sincerely,?$/i;

function sentencesOf(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSecondPerson(sentence: string): boolean {
  return SECOND_PERSON_RE.test(sentence);
}
export function restatesJd(sentence: string): boolean {
  return RESTATES_JD_RE.test(sentence.trim());
}
export function hasHonestGap(letter: string): boolean {
  return HONEST_GAP_RE.test(letter || "");
}

// The letter with the offending sentences removed (paragraphs kept, an
// emptied one dropped), and what went. The first body sentence — the role
// by name — is never removed, nor anything after the sign-off.
export function applyLetterLint(letter: string): { text: string; lint: LetterLint } {
  const lint: LetterLint = { secondPerson: [], restatedJd: [] };
  if (!letter || !letter.trim()) return { text: letter, lint };
  const lines = letter.replace(/\r/g, "").split("\n");
  let bodySeen = false;
  let afterSignoff = false;
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || afterSignoff) return line;
    if (SIGNOFF_RE.test(t)) {
      afterSignoff = true;
      return line;
    }
    if (SALUTATION_RE.test(t)) return line;
    const kept = sentencesOf(t).flatMap((s) => {
      const first = !bodySeen;
      bodySeen = true;
      if (first) return [s];
      if (restatesJd(s)) {
        // "The team is building X, and I built Y." — the posting's half goes,
        // the candidate's own clause stays (review, 1 Oct).
        const own = /,\s*(?:and\s+|but\s+|while\s+|so\s+)?((?:I|I've|I’ve|I'm|I’m|I'd|I’d|my|we|we've|we’ve)\b.*)$/.exec(s);
        lint.restatedJd.push(s);
        if (own) return [own[1].charAt(0).toUpperCase() + own[1].slice(1)];
        return [];
      }
      if (isSecondPerson(s)) {
        lint.secondPerson.push(s);
        return [];
      }
      return [s];
    });
    return kept.join(" ");
  });
  const changed = lint.secondPerson.length + lint.restatedJd.length > 0;
  return { text: changed ? out.join("\n").replace(/\n{3,}/g, "\n\n").trim() : letter, lint };
}
