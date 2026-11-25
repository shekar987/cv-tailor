// /api/tailor/smart — Smart Match: deterministic CV reordering.
// No AI call. No credit spent. Signed-in users only, burst-rate-limited.
// Returns the same CV document shape the preview and downloads already use.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody, declaresMoreThan, payloadTooLarge } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { smartMatch, type Project } from "@/lib/smartMatch";
import { matchAtsKeywords } from "@/lib/atsMatch";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CV = 50_000;
const MAX_JD = 20_000;

export async function POST(req: NextRequest) {
  if (declaresMoreThan(req, 200_000)) return payloadTooLarge();

  const caller = await signedIn();
  if (!caller) return unauthorized();

  const burst = await checkBurstLimit(caller.userId, "smart-match", { limit: 20, windowSeconds: 60 });
  if (!burst.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again.", errorType: "burst_limit" },
      { status: 429 },
    );
  }

  const body = await readJsonBody(req);
  if (!body) return invalidBody();

  const cvText = typeof body.cvText === "string" ? body.cvText.slice(0, MAX_CV) : "";
  const jdText = typeof body.jobDescription === "string" ? body.jobDescription.slice(0, MAX_JD) : "";

  if (!cvText.trim()) {
    return NextResponse.json({ error: "Your main CV is missing." }, { status: 400 });
  }
  if (!jdText.trim()) {
    return NextResponse.json({ error: "The job description is missing." }, { status: 400 });
  }

  const rawProjects = Array.isArray(body.projects) ? body.projects : [];
  const projects: Project[] = rawProjects
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      name: typeof p.name === "string" ? p.name : "",
      tech: Array.isArray(p.tech) ? p.tech.filter((t: unknown) => typeof t === "string") : [],
      originalBullets: Array.isArray(p.originalBullets)
        ? p.originalBullets.filter((b: unknown) => typeof b === "string")
        : [],
      label: typeof p.label === "string" ? p.label : undefined,
    }));

  const result = smartMatch(cvText, jdText, projects);

  // Compute ATS score against any JD keywords provided by the client (the
  // gate's top_15 list). No model call — the same deterministic matcher.
  const rawKeywords = Array.isArray(body.keywords) ? body.keywords : [];
  const keywords = rawKeywords.filter((k: unknown): k is string => typeof k === "string");
  const atsScore =
    keywords.length > 0
      ? (() => {
          const textToScore = [
            result.sections.summary,
            result.sections.skills,
            result.sections.experience,
            ...Object.values(result.sections.projects).flat(),
          ].join("\n");
          const r = matchAtsKeywords(textToScore, keywords);
          return { matched: r.matched, total: r.total, matchedKeywords: r.matchedKeywords, missedKeywords: r.missedKeywords };
        })()
      : null;

  return NextResponse.json({
    // Wire format CvPreview and downloads already consume:
    summary: result.sections.summary,
    skills: result.sections.skills,
    experience: result.sections.experience,
    projects: result.sections.projects,
    coverLetter: "",
    // Smart Match extras:
    isFreeMatch: true,
    coverage: result.coverage,
    gaps: result.gaps,
    evidenceIds: result.evidenceIds,
    // TL-4: requirement → first 60 chars of matching bullet (empty when no worker selection).
    coveredBy: result.coveredBy,
    // ATS score (may be null if no keyword list provided):
    atsScore,
  });
}
