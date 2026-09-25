// Unit tests for the deterministic keyword matcher. Runs on node:test with
// zero dependencies: `npm test`. The CV below is SYNTHETIC — never the owner's
// real CV from src/prompts/masterCV.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAtsKeywords, tailoredSectionsText } from "../src/lib/atsMatch.ts";

const hit = (cv: string, kw: string) => matchAtsKeywords(cv, [kw]).matched === 1;

test("partition: every keyword lands in exactly one list, order preserved", () => {
  const cv = "Python and Docker. Continuous learning.";
  const kws = ["Python", "Machine learning", "Docker", "", "  ", 42 as unknown as string, "Rust"];
  const r = matchAtsKeywords(cv, kws);
  assert.deepEqual(r.matchedKeywords, ["Python", "Docker"]);
  assert.deepEqual(r.missedKeywords, ["Machine learning", "Rust"]);
  assert.equal(r.total, 4);
  assert.equal(r.matched + r.missedKeywords.length, r.total);
  for (const k of r.matchedKeywords) assert.ok(!r.missedKeywords.includes(k));
  assert.deepEqual(matchAtsKeywords(cv, "not an array"), { matched: 0, total: 0, matchedKeywords: [], missedKeywords: [] });
});

test("whole-word, case-insensitive", () => {
  assert.ok(!hit("Built the UI in JavaScript", "Java"));
  assert.ok(hit("Backend in JAVA 17", "java"));
  assert.ok(!hit("Java services", "JavaScript"));
  assert.ok(!hit("TypeScript everywhere", "JavaScript"));
});

test("audit regressions: a single token of a multi-word keyword is not a match", () => {
  assert.ok(!hit("Committed to continuous learning.", "Machine learning"));
  assert.ok(hit("Shipped machine learning features", "Machine learning"));
  assert.ok(hit("Shipped machine-learning features", "Machine learning"));
  assert.ok(hit("Applied machine and learning models", "Machine learning"));
  // One filler token between terms is the limit — conservative by design.
  assert.ok(!hit("Applied machine and deep learning models", "Machine learning"));
  assert.ok(!hit("Completed a state machine workshop.\n\nContinuous learning: reads papers weekly.", "Machine learning"));
  assert.ok(!hit("Built React dashboards", "React Native"));
  assert.ok(hit("Built React Native apps", "React Native"));
  assert.ok(!hit("Built React apps and native iOS apps", "React Native"));
  assert.ok(!hit("Cloud infrastructure and IaC", "Machine learning"));
});

test("canonical naming variants", () => {
  assert.ok(hit("Postgres tuning", "PostgreSQL"));
  assert.ok(hit("PostgreSQL tuning", "Postgres"));
  assert.ok(hit("C#/.NET developer", "C#"));
  assert.ok(!hit("C++ developer", "C#"));
  assert.ok(hit("Systems in C++", "C++"));
  assert.ok(hit("ASP.NET Core APIs", ".NET"));
  assert.ok(!hit("Grew net income 10%", ".NET"));
  assert.ok(hit("Ran workloads on Kubernetes", "K8s"));
  assert.ok(hit("k8s clusters", "Kubernetes"));
  assert.ok(hit("NodeJS services", "Node.js"));
  assert.ok(hit("node js services", "Node.js"));
  assert.ok(!hit("Kubernetes nodes", "Node.js"));
  assert.ok(hit("Modern JavaScript", "JS"));
  assert.ok(hit("Deployed to AWS", "Amazon Web Services"));
  assert.ok(hit("Deployed to GCP", "Google Cloud Platform"));
  assert.ok(hit("CI-CD with GitHub Actions", "CI/CD pipelines"));
  assert.ok(hit("Set up continuous integration", "CI/CD"));
  assert.ok(hit("RESTful API design", "REST APIs"));
  assert.ok(hit("Stored sessions in MongoDB", "Mongo"));
  assert.ok(hit("Full-stack ownership", "Fullstack development"));
  assert.ok(hit("A/B tested the checkout", "A/B testing"));
});

test("vendor qualifiers don't change what the thing is", () => {
  assert.ok(hit("Streams over Kafka", "Apache Kafka"));
  assert.ok(!hit("Apache licence", "Apache Kafka"));
  assert.ok(hit("Provisioned with Terraform", "HashiCorp Terraform"));
  // Written literally, the phrase is a genuine hit; without it, a
  // qualifier-only remainder ("microsoft" + the filler "teams") is not.
  assert.ok(hit("Used Microsoft Teams daily", "Microsoft Teams"));
  assert.ok(!hit("Worked in cross-team squads", "Microsoft Teams"));
});

test("all-generic phrases need every term, close together", () => {
  assert.ok(hit("Led system design reviews", "System design"));
  assert.ok(hit("Designed distributed systems", "System design"));
  assert.ok(!hit("Maintained the system", "System design"));
  assert.ok(!hit("Maintained the system.\n\nLater led design workshops for the marketing team.", "System design"));
});

test("alternatives and conjunctions", () => {
  assert.ok(hit("Two-week Scrum sprints", "Agile/Scrum"));
  assert.ok(hit("Objects in S3 buckets", "AWS (Lambda, S3)"));
  assert.ok(!hit("Azure Functions", "AWS (Lambda, S3)"));
  assert.ok(hit("Express middleware", "Node.js/Express"));
  assert.ok(hit("Kotlin on Android", "Java or Kotlin"));
  assert.ok(hit("Ran code reviews weekly.\n\nMentored two juniors.", "Code review and mentoring"));
  assert.ok(!hit("Ran code reviews weekly.", "Code review and mentoring"));
});

test("morphology and descriptor nouns", () => {
  assert.ok(hit("Wrote unit tests for every module", "Unit testing"));
  assert.ok(hit("Containerised with Docker", "Docker containerization"));
  assert.ok(hit("GraphQL gateway", "GraphQL APIs"));
  assert.ok(hit("Split the monolith into micro-services", "Microservices architecture"));
  assert.ok(hit("Python scripts", "Python 3"));
  assert.ok(hit("Collaboration with cross-functional teams", "Cross-functional collaboration"));
  assert.ok(hit("Cached hot paths in Redis", "Redis caching"));
  // Conservative by design: PostgreSQL alone does not claim "SQL".
  assert.ok(!hit("PostgreSQL schemas", "SQL"));
  assert.ok(!hit("Hands-on experience required", "Hands-on experience"));
});

test("a realistic analyser keyword list against a synthetic CV", () => {
  const cv = `Jane Doe — Backend Engineer
Skills: Python 3, Django, PostgreSQL, Redis, Docker, Kubernetes, AWS (Lambda, S3, EC2), GraphQL, REST, CI/CD (GitHub Actions), Agile/Scrum

Backend Engineer | Acme | 2022 – Present
• Designed distributed systems serving 2M requests/day; led system design reviews.
• Built RESTful APIs in Django with unit tests and integration tests (92% coverage).
• Containerised services with Docker and deployed to Kubernetes via CI/CD pipelines.
• Cut p95 latency 40% with Redis caching.
• Ran code reviews and mentored two junior engineers.

Projects
• Workshop: implemented a state machine for order lifecycles.

Continuous learning: reads distributed-systems papers weekly.`;
  const keywords = [
    "Python", "Django", "REST APIs", "PostgreSQL", "AWS (Lambda, S3)", "Docker containerization",
    "Kubernetes", "CI/CD pipelines", "Microservices architecture", "Unit testing", "Agile/Scrum",
    "GraphQL", "Redis caching", "System design", "Machine learning",
  ];
  const r = matchAtsKeywords(cv, keywords);
  assert.deepEqual(r.missedKeywords, ["Microservices architecture", "Machine learning"]);
  assert.equal(r.matched, 13);
  assert.equal(r.total, 15);
});

test("tailoredSectionsText joins the sections the scorer sees", () => {
  const text = tailoredSectionsText({
    summary: "Sum",
    skills: "Sk",
    experience: "Exp",
    projects: { "1": ["b2", 7], "0": ["b1"] },
  });
  // Project bullets follow index order ("0" before "1"), whatever the insertion order.
  assert.equal(text, "Sum\nSk\nExp\nb1\nb2");
  assert.equal(tailoredSectionsText({}), "");
  assert.equal(tailoredSectionsText({ summary: "only", projects: "not an object" }), "only");
});

test("RAG spelled out is the same term (retrieval-augmented generation)", () => {
  assert.equal(matchAtsKeywords("Built retrieval-augmented generation pipelines.", ["RAG"]).matched, 1);
  assert.equal(matchAtsKeywords("Built a RAG pipeline.", ["Retrieval Augmented Generation"]).matched, 1);
  assert.equal(matchAtsKeywords("Moved object storage to S3.", ["RAG"]).matched, 0, "a word that only contains the letters is not the term");
});
