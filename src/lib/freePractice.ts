// Free-tier interview practice: question builder + STAR structure checker.
// Pure logic — no AI, no network, no imports from lib/claude.ts.

export type FreeBullet = {
  id: string;    // e.g. "R1.2" (roleIndex.bulletIndex)
  text: string;
};

export type FreeQuestion = {
  id: string;             // "q1" through "q5"
  text: string;           // the question the user reads aloud
  intent: string;         // short label shown in the summary table
  suggestedStoryId: string | null;
  suggestedStory: string | null;
};

export type StarCheck = {
  situation: boolean;
  task: boolean;
  action: boolean;
  result: boolean;
  resultHasNumber: boolean;
};

export type StarScore = {
  check: StarCheck;
  parts: number;      // 0–4 (STAR parts present, not counting resultHasNumber)
  missing: string[];  // human-readable names of missing STAR parts
  label: "structure only, not content";
};

// ── Stop words for overlap scoring ──────────────────────────────────────────

const STOP = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","as","is","was","are","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "need","must","am","i","you","we","they","it","this","that","these","those",
  "not","no","yet","so","if","all","any","some","your","our","their","its",
  "his","her","my","what","how","why","when","where","who","which","also",
  "both","each","few","more","most","other","than","then","there","up","out",
  "about","after","before","between","into","through","during","without",
  "per","using","use","used","uses","using","able","ability","strong","good",
  "excellent","solid","proven","demonstrable","relevant","practical",
]);

function tokens(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9#.+/\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-]+|[-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function overlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  return tokens(b).filter((w) => ta.has(w)).length;
}

// ── STAR patterns ────────────────────────────────────────────────────────────

const SIT_PATTERNS = [
  /\bI was (working|employed|based|leading|managing)\b/i,
  /\bin my (previous|last|current|prior|former|first) (role|position|job)\b/i,
  /\bwhen I (joined|started|worked at|was at|was working)\b/i,
  /\bduring my (time at|tenure|internship|placement|secondment)\b/i,
  /\bour (team|company) was\b/i,
  /\bat the time\b/i,
  /\b(context|situation|background)\s*[:—]\s*/i,
  /\bI (joined|moved to|transferred to)\b.*?\bto (work|build|lead|manage)\b/i,
];

const TASK_PATTERNS = [
  /\bI (needed to|had to|was asked to|was tasked (with|to))\b/i,
  /\bI was responsible for\b/i,
  /\b(my|the|our) (task|goal|objective|challenge|aim|mission) was\b/i,
  /\bthe problem (I|we) (faced|encountered|had)\b/i,
  /\bour (objective|goal|aim|target) was\b/i,
  /\bI was given (the task|responsibility|a goal|a target)\b/i,
  /\bthe (challenge|issue|problem|requirement) was\b/i,
];

const ACT_PATTERNS = [
  /\bI (decided|built|implemented|created|designed|developed|led|managed|wrote|solved|introduced|organized|set up|deployed|refactored|tested|launched|delivered|coordinated|proposed|presented|negotiated|analysed|analyzed|automated|optimized|optimised|restructured|migrated|configured|trained|mentored|rebuilt|rewrote|integrated|enabled|extended|reviewed|shipped|rolled out|worked on|took over|took the lead)\b/i,
  /\bso I (decided|built|implemented|created|designed|worked|took|started|wrote|launched|fixed|changed|updated)\b/i,
  /\bmy (approach|solution|first step) was\b/i,
  /\bwhat I did (was|first)\b/i,
  /\bI first (decided|built|implemented|created|worked|started|set up|analysed|analyzed|reviewed)\b/i,
  /\bI took the (lead|initiative|decision|approach)\b/i,
  /\bstep[s]? I took\b/i,
];

const RES_PATTERNS = [
  /\bas a result\b/i,
  /\bwhich led to\b/i,
  /\bresulted in\b/i,
  /\bthe (outcome|result|impact|effect) (was|were|is)\b/i,
  /\bthis (led to|enabled|meant|allowed|resulted in|helped|reduced|improved)\b/i,
  /\bwe (achieved|managed to|reduced|improved|saved|cut|increased|grew|delivered|completed|hit the target|met the deadline|secured)\b/i,
  /\b(ultimately|consequently|in the end)\b/i,
  /\bthe impact (was|is)\b/i,
  /\b(reduced|improved|saved|increased|grew|cut|doubled|accelerated|shortened) (it |them |that |by |from |to )/i,
  /\bmeeting (the|our|their) (target|deadline|goal|objective)\b/i,
];

const NUM_PATTERN = /(\d+(\.\d+)?[\s]*((%|per\s*cent|percent|users?|customers?|minutes?|hours?|days?|weeks?|months?|pounds?|£|\$|€|times|ms|rpm|rps|k\b|m\b))|\b\d{2,}\b(?!\.\d)|(2|3|4|5)×|twice|doubled|tripled|halved|tenfold)/i;

function anyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

// ── extractRequirements ──────────────────────────────────────────────────────

// Extract the top skill / requirement phrases from a job description.
export function extractRequirements(jd: string): string[] {
  const lines = jd.split("\n");
  const collected: string[] = [];
  let inReqSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Detect "requirements" section headers
    if (/^(requirements?|essential[s]?|what (you[' ]ll|you will)|must[- ]have|skills (we|you)|qualifications?|looking for|you (should|will) have|about you|we.?re looking|key (skills|requirements|experience))\b/i.test(line)) {
      inReqSection = true;
      continue;
    }
    // Stop at unrelated sections
    if (/^(nice[- ]to[- ]have|desirable|bonus|what we offer|benefits|about (us|the company|the role|the team)|the (role|job)|responsibilities|what you.?ll do|your responsibilities|perks|salary|compensation)\b/i.test(line)) {
      inReqSection = false;
      continue;
    }

    // Extract bullet lines
    const bullet = line.replace(/^[-•*]\s*/, "");
    if (bullet === line) continue; // not a bullet
    if (bullet.length < 8 || bullet.length > 200) continue;

    if (
      inReqSection ||
      /\b(experience|knowledge|understanding|proficiency|familiar|skill|degree|background|ability to|worked|building|developing|exposure to|worked with)\b/i.test(bullet)
    ) {
      collected.push(bullet);
    }
  }

  return [...new Set(collected)].slice(0, 10);
}

// ── parseBulletsFromText ──────────────────────────────────────────────────────

// Parse experience section text (from tailored_cv.sections.experience) into bullets.
export function parseBulletsFromText(experienceText: string): FreeBullet[] {
  const bullets: FreeBullet[] = [];
  let roleIndex = 0;
  let bulletIndex = 0;

  for (const raw of experienceText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // Role header: contains " | " and doesn't start with a bullet marker
    if (!(/^[•\-*]/.test(line)) && line.includes(" | ")) {
      roleIndex++;
      bulletIndex = 0;
      continue;
    }

    // Bullet line
    const stripped = line.replace(/^[•\-*]\s*/, "");
    if (stripped === line) continue; // no bullet marker
    if (stripped.length < 12) continue;

    bulletIndex++;
    bullets.push({ id: `R${roleIndex}.${bulletIndex}`, text: stripped });
  }

  return bullets;
}

// ── extractProjectNames ───────────────────────────────────────────────────────

// Extract project names from the projects section text.
export function extractProjectNames(projectsText: string): string[] {
  const names: string[] = [];
  for (const raw of projectsText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[•\-*]/.test(line)) continue; // bullet, not a heading
    if (line.length < 3 || line.length > 100) continue;
    // Strip date suffixes, pipe-separated meta, em-dash, parenthetical stack list
    const name = line
      .split("|")[0]
      .split("·")[0]
      .split("—")[0]
      .split("–")[0]
      .replace(/\s*\([^)]*\)$/, "")
      .trim();
    if (name.length >= 3) names.push(name);
  }
  return [...new Set(names)];
}

// ── requirementToPhrase ───────────────────────────────────────────────────────

// Strips common prefixes from a requirement string to get a usable key phrase.
function requirementToPhrase(req: string): string {
  let r = req.trim().replace(/[.,;:]+$/, "");
  // Remove years qualifiers
  r = r.replace(/^\d+\+?\s*(or more\s*)?(years?\s+(of\s+)?)?/i, "");
  // Remove adjectives
  r = r.replace(/^(strong|solid|excellent|good|proven|demonstrable|relevant|practical|advanced|extensive)\s+/i, "");
  // Remove common skill prefixes
  r = r.replace(
    /^(experience (with|in|using|building|developing|designing|working with)|knowledge of|understanding of|proficiency in|ability to|skills? (in|with)|familiarity with|background in|expertise in|working knowledge of|exposure to|understanding and experience (with|in))\s+/i,
    ""
  );
  // Remove trailing redundant words
  r = r.replace(/\s+(experience|skills?|knowledge|background|expertise)$/i, "");
  r = r.trim();
  return r.length >= 3 ? r.charAt(0).toLowerCase() + r.slice(1) : req.toLowerCase().trim();
}

// ── Generic fallback questions ────────────────────────────────────────────────

const GENERIC_BEHAVIORAL: Array<{ text: string; intent: string }> = [
  { text: "Tell me about a challenging technical problem you solved.", intent: "Problem solving" },
  { text: "Tell me about a time you had to learn something new quickly.", intent: "Learning agility" },
  { text: "Describe a situation where you worked well in a team.", intent: "Teamwork" },
];

// ── buildFreeQuestions ────────────────────────────────────────────────────────

export function buildFreeQuestions({
  requirements,
  bullets,
  projectNames,
  company,
}: {
  requirements: string[];
  bullets: FreeBullet[];
  projectNames: string[];
  company?: string;
}): FreeQuestion[] {
  const questions: FreeQuestion[] = [];
  const usedBulletIds = new Set<string>();

  // Up to 3 behavioral questions from requirements
  const topReqs = requirements.slice(0, 3);
  for (let i = 0; i < 3; i++) {
    const req = topReqs[i];
    if (!req) {
      // Pad with a generic question
      const generic = GENERIC_BEHAVIORAL[i] ?? GENERIC_BEHAVIORAL[0];
      questions.push({
        id: `q${questions.length + 1}`,
        text: generic.text,
        intent: generic.intent,
        suggestedStoryId: null,
        suggestedStory: null,
      });
      continue;
    }

    // Find best matching bullet (stable: highest overlap, then lowest array index)
    let bestIdx = -1;
    let bestScore = -1;
    for (let j = 0; j < bullets.length; j++) {
      if (usedBulletIds.has(bullets[j].id)) continue;
      const score = overlap(req, bullets[j].text);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    const phrase = requirementToPhrase(req);
    const questionText = `Tell me about your experience with ${phrase}.`;
    const intent = phrase.charAt(0).toUpperCase() + phrase.slice(1);

    if (bestIdx >= 0 && bestScore > 0) {
      const bullet = bullets[bestIdx];
      usedBulletIds.add(bullet.id);
      questions.push({
        id: `q${questions.length + 1}`,
        text: questionText,
        intent,
        suggestedStoryId: bullet.id,
        suggestedStory: bullet.text,
      });
    } else {
      questions.push({
        id: `q${questions.length + 1}`,
        text: questionText,
        intent,
        suggestedStoryId: null,
        suggestedStory: null,
      });
    }
  }

  // 1 project question
  const project = projectNames[0];
  if (project) {
    questions.push({
      id: `q${questions.length + 1}`,
      text: `Walk me through your work on ${project}.`,
      intent: project,
      suggestedStoryId: null,
      suggestedStory: null,
    });
  } else {
    questions.push({
      id: `q${questions.length + 1}`,
      text: "Walk me through a project you are most proud of.",
      intent: "Favourite project",
      suggestedStoryId: null,
      suggestedStory: null,
    });
  }

  // 1 motivation question
  const companyPart = company ? ` at ${company}` : "";
  questions.push({
    id: `q${questions.length + 1}`,
    text: `Why are you interested in this role${companyPart}?`,
    intent: "Motivation",
    suggestedStoryId: null,
    suggestedStory: null,
  });

  return questions; // exactly 5
}

// ── checkStar ─────────────────────────────────────────────────────────────────

export function checkStar(answer: string): StarScore {
  const situation = anyPattern(answer, SIT_PATTERNS);
  const task = anyPattern(answer, TASK_PATTERNS);
  const action = anyPattern(answer, ACT_PATTERNS);
  const result = anyPattern(answer, RES_PATTERNS);
  const resultHasNumber = result && NUM_PATTERN.test(answer);

  const check: StarCheck = { situation, task, action, result, resultHasNumber };
  const parts = [situation, task, action, result].filter(Boolean).length;
  const missing: string[] = [];
  if (!situation) missing.push("Situation");
  if (!task) missing.push("Task");
  if (!action) missing.push("Action");
  if (!result) missing.push("Result");

  return { check, parts, missing, label: "structure only, not content" };
}
