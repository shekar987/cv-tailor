// The mock-interview rounds, their fixed questions and the interviewers who
// run them (the owner's plan, 29 Sep 2026). Import-free data, so the route,
// the page and node:test all read one definition.
//
// The rounds follow how UK employers actually interview (Indeed UK,
// Prospects, the Civil Service Success Profiles): a short screening call, a
// competency interview answered with STAR, a strengths-based interview for
// graduate schemes, a technical round, a hiring-manager round and a final
// round with a senior leader. Code, not the model, writes the questions every
// UK employer asks the same way (right to work, notice, salary) and every
// line that opens or closes the interview.

export const INTERVIEW_TYPES = ["screening", "competency", "strengths", "technical", "hiring_manager", "final"] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export function isInterviewType(value: unknown): value is InterviewType {
  return typeof value === "string" && (INTERVIEW_TYPES as readonly string[]).includes(value);
}

// How an answer is judged (lib/mockInterview readout). Logistics answers are
// read by code alone; the others by the model's quoted checks.
export const RUBRICS = [
  "background",
  "motivation",
  "star",
  "strength",
  "technical",
  "logistics_rtw",
  "logistics_notice",
  "logistics_salary",
  "logistics_location",
] as const;
export type Rubric = (typeof RUBRICS)[number];
export const isLogistics = (r: Rubric) => r.startsWith("logistics_");

export type StockQuestion = { text: string; rubric: Rubric };

export type Persona = {
  id: string;
  name: string;
  firstName: string;
  gender: "female" | "male";
  // British Kokoro voice (HeadTTS) and the avatar model the page loads.
  kokoroVoice: string;
  avatar: string;
};

export type RoundTemplate = {
  type: InterviewType;
  label: string;
  // What the setup screen says the round is for.
  summary: string;
  assesses: string[];
  interviewerRole: string;
  // How they introduce themselves ("the Engineering Manager for this team").
  introRole: string;
  persona: string;
  minutes: number;
  // Questions the model writes for this round (the fixed ones are added).
  modelQuestions: number;
  modelRubric: Rubric;
  // The kinds of question this round asks; a model question of another kind
  // is dropped (a live competency plan came back with technical questions).
  modelRubrics: Rubric[];
  // Tells the plan prompt what to ask in this round.
  guidance: string;
  // How a real interviewer in this round probes an answer.
  probeStyle: string;
  fixedBefore: StockQuestion[];
  fixedAfter: StockQuestion[];
  stock: StockQuestion[];
};

// v1 has two faces: Emma runs the people-facing rounds and Daniel the
// engineering ones. Each keeps one name across rounds — six names on two
// faces would look fake.
export const PERSONAS: Record<string, Persona> = {
  emma: { id: "emma", name: "Emma Clarke", firstName: "Emma", gender: "female", kokoroVoice: "bf_emma", avatar: "/interview/avatars/emma-v2.glb" },
  daniel: { id: "daniel", name: "Daniel Okafor", firstName: "Daniel", gender: "male", kokoroVoice: "bm_george", avatar: "/interview/avatars/daniel-v2.glb" },
};

// Asked in every round, by code, exactly like this.
export const RTW_QUESTION = "Are you currently eligible to work in the UK, and will you need visa sponsorship now or in the future?";
export const CLOSE_QUESTION = "That's everything from me. Do you have any questions for me?";
export const ANOTHER_QUESTION = "Is there anything else you'd like to ask?";
export const MAX_ANSWERS = 18;
export const MAX_CANDIDATE_QUESTIONS = 2;
export const MAX_ANSWER_CHARS = 4000;

export const ROUNDS: Record<InterviewType, RoundTemplate> = {
  screening: {
    type: "screening",
    label: "Screening call",
    summary: "A short call with a recruiter: why this role, your background, and the practical questions every UK employer asks.",
    assesses: ["Motivation for the role", "How your CV fits", "Right to work, notice, salary and location"],
    interviewerRole: "Talent Acquisition Partner",
    introRole: "one of the Talent Acquisition Partners",
    persona: "emma",
    minutes: 15,
    modelQuestions: 2,
    modelRubric: "motivation",
    modelRubrics: ["motivation", "background"],
    guidance:
      "Write 2 questions a recruiter asks on a first call: one on why this role and this company appeal to the candidate, and one asking them to connect a specific part of the CV they sent to the job's main requirement. Friendly, brisk, practical.",
    probeStyle: "Light and clarifying: ask for one specific detail when an answer stays general.",
    fixedBefore: [{ text: "To start, could you walk me through your background and what you're doing at the moment?", rubric: "background" }],
    fixedAfter: [
      { text: RTW_QUESTION, rubric: "logistics_rtw" },
      { text: "What's your notice period, or when would you be able to start?", rubric: "logistics_notice" },
      { text: "What are your salary expectations for this role?", rubric: "logistics_salary" },
      { text: "How do the working pattern and location for this role suit you?", rubric: "logistics_location" },
    ],
    stock: [
      { text: "What attracted you to this role?", rubric: "motivation" },
      { text: "Which part of your experience is most relevant to this job, and why?", rubric: "background" },
    ],
  },
  competency: {
    type: "competency",
    label: "Competency interview",
    summary: "The classic UK structured interview: \"Tell me about a time when…\" questions, answered with STAR and probed for what you did yourself.",
    assesses: ["Evidence of the behaviours the job asks for", "Your own actions", "Results"],
    interviewerRole: "HR Business Partner",
    introRole: "an HR Business Partner",
    persona: "emma",
    minutes: 30,
    modelQuestions: 4,
    modelRubric: "star",
    modelRubrics: ["star"],
    guidance:
      "Pick the 4 behaviours this job needs most (from its requirements and responsibilities: e.g. delivering to deadlines, problem solving, working with others, communicating technical work, adapting to change, taking ownership) and write one competency question for each, opening \"Tell me about a time when…\" or \"Can you give me an example of…\". Formal and structured, as in a UK HR panel.",
    probeStyle: "Structured STAR probing: what did you do yourself, what was the result, what would you do differently.",
    fixedBefore: [{ text: "Could you give me a brief overview of your experience so far?", rubric: "background" }],
    fixedAfter: [],
    stock: [
      { text: "Tell me about a time you had to deliver something under a tight deadline.", rubric: "star" },
      { text: "Tell me about a time something you built didn't work as expected. What did you do?", rubric: "star" },
      { text: "Tell me about a time you had to learn something new quickly.", rubric: "star" },
      { text: "Can you give me an example of explaining a technical problem to someone non-technical?", rubric: "star" },
      { text: "Tell me about a time you disagreed with a colleague. How did you handle it?", rubric: "star" },
    ],
  },
  strengths: {
    type: "strengths",
    label: "Strengths-based interview",
    summary: "Used by UK graduate schemes: quick questions about what energises you and what you naturally do well. Answer honestly rather than with a prepared story.",
    assesses: ["What energises you", "Natural strengths", "Fit with the scheme"],
    interviewerRole: "Early Careers Recruiter",
    introRole: "an Early Careers Recruiter",
    persona: "emma",
    minutes: 20,
    modelQuestions: 6,
    modelRubric: "strength",
    modelRubrics: ["strength"],
    guidance:
      "Write 6 short strengths-based questions as UK graduate schemes ask them (\"What kind of tasks give you the most energy?\", \"Do you prefer starting things or finishing them?\"), tuned to this role's day-to-day work. Quick, upbeat, one idea each. No \"Tell me about a time\" questions.",
    probeStyle: "Quick and curious: ask why they enjoy it, or for one moment they felt that way.",
    fixedBefore: [],
    fixedAfter: [{ text: "What made you apply for this programme?", rubric: "motivation" }],
    stock: [
      { text: "What kind of tasks give you the most energy?", rubric: "strength" },
      { text: "When do you feel you're at your best?", rubric: "strength" },
      { text: "Do you prefer starting new things or finishing them? Why?", rubric: "strength" },
      { text: "What do you find yourself doing even when nobody has asked you to?", rubric: "strength" },
      { text: "How do you like to receive feedback?", rubric: "strength" },
      { text: "What's something you've learned recently just because you wanted to?", rubric: "strength" },
    ],
  },
  technical: {
    type: "technical",
    label: "Technical interview",
    summary: "A spoken technical round with an engineer: a deep dive into a project on your CV, the job's stack, trade-offs, debugging and testing. No live coding.",
    assesses: ["Depth in your own projects", "The job's technologies", "Reasoning and trade-offs"],
    interviewerRole: "Senior Software Engineer",
    introRole: "a Senior Software Engineer on the team",
    persona: "daniel",
    minutes: 35,
    modelQuestions: 4,
    modelRubric: "technical",
    modelRubrics: ["technical"],
    guidance:
      "Write 4 technical discussion questions an engineer asks out loud: one on a technology the job needs that the CV they sent shows, one design or trade-off question grounded in the job's product, one debugging or incident scenario, and one on testing or code quality. Answerable in speech, no coding on a whiteboard.",
    probeStyle: "Collegial and curious: how would that scale, what alternatives did you consider, what would you change.",
    fixedBefore: [{ text: "Could you pick a project from your CV you're proud of and talk me through how it works?", rubric: "technical" }],
    fixedAfter: [],
    stock: [
      { text: "How do you make sure the code you ship is reliable?", rubric: "technical" },
      { text: "How would you track down the cause of a slow API endpoint?", rubric: "technical" },
      { text: "Tell me about a technical decision where you had to weigh up trade-offs.", rubric: "technical" },
      { text: "How would you approach designing the database schema for a new feature?", rubric: "technical" },
    ],
  },
  hiring_manager: {
    type: "hiring_manager",
    label: "Hiring manager round",
    summary: "With the person you'd report to: how you work, prioritise, take ownership and collaborate, and why this team.",
    assesses: ["Ownership", "Prioritisation", "Working with others", "Motivation for this team"],
    interviewerRole: "Engineering Manager",
    introRole: "the Engineering Manager for this team",
    persona: "daniel",
    minutes: 30,
    modelQuestions: 4,
    modelRubric: "star",
    modelRubrics: ["star", "motivation"],
    guidance:
      "Write 4 questions a hiring manager asks about ways of working, each tied to this job's responsibilities: prioritising competing work, taking ownership of a problem, working with product/design/stakeholders, and handling feedback or a mistake. Direct and practical.",
    probeStyle: "Direct: ask for an example, what they learned, or how they'd handle it here.",
    fixedBefore: [{ text: "What interests you about joining this team?", rubric: "motivation" }],
    fixedAfter: [],
    stock: [
      { text: "How do you prioritise when you have more work than time?", rubric: "star" },
      { text: "Tell me about a time you took ownership of something beyond your role.", rubric: "star" },
      { text: "How do you like to work with product managers and designers?", rubric: "star" },
      { text: "Tell me about feedback you received that changed how you work.", rubric: "star" },
    ],
  },
  final: {
    type: "final",
    label: "Final round",
    summary: "With a senior leader: values, motivation, long-term goals and how you'd approach your first months. Usually the last step before an offer.",
    assesses: ["Motivation and values", "Long-term goals", "How you'd start"],
    interviewerRole: "Head of Engineering",
    introRole: "the Head of Engineering",
    persona: "daniel",
    minutes: 25,
    modelQuestions: 3,
    modelRubric: "motivation",
    modelRubrics: ["motivation", "star"],
    guidance:
      "Write 3 questions a senior leader asks in a final round: one on how the candidate's values fit the company's (use the company research when present), one on long-term goals and how this role fits them, and one on how they'd approach their first ninety days in this job. Calm, big-picture.",
    probeStyle: "Calm and probing on motivation: why that matters to you, what it would look like here.",
    fixedBefore: [{ text: "Having gone through the process so far, what's made you keen to join us?", rubric: "motivation" }],
    fixedAfter: [
      { text: "Is there anything about your situation we should know as we think about next steps, for example your notice period?", rubric: "logistics_notice" },
    ],
    stock: [
      { text: "Where would you like your career to be in a few years?", rubric: "motivation" },
      { text: "Tell me about a time you had to work with a lot of ambiguity.", rubric: "star" },
      { text: "What would you want to achieve in your first ninety days here?", rubric: "motivation" },
    ],
  },
};

export function personaFor(type: InterviewType): Persona {
  return PERSONAS[ROUNDS[type].persona];
}

// The opening line, written by code: who the interviewer is, the company and
// how long it will take.
export function openingLine(type: InterviewType, firstName: string, company: string): string {
  const round = ROUNDS[type];
  const persona = personaFor(type);
  const hello = firstName ? `Hi ${firstName}, thanks for joining.` : "Hi, thanks for joining.";
  const at = company ? ` at ${company}` : "";
  return `${hello} I'm ${persona.firstName}, ${round.introRole}${at}. This should take about ${round.minutes} minutes.`;
}

export function goodbyeLine(firstName: string): string {
  return `Thanks for your time today${firstName ? `, ${firstName}` : ""}. We'll be in touch about next steps.`;
}
