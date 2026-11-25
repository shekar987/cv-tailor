// /api/tailor/letter-smart — Free cover letter from CV evidence.
// No AI call. No credit spent. Signed-in users only, burst-rate-limited.
import { NextRequest, NextResponse } from "next/server";
import {
  signedIn,
  unauthorized,
  readJsonBody,
  invalidBody,
  declaresMoreThan,
  payloadTooLarge,
} from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { parseMasterExperience } from "@/lib/bulletIds";
import { buildLetterFromEvidence, type EvidenceSource } from "@/lib/letterFromEvidence";

export const runtime = "nodejs";
export const maxDuration = 10;

const MAX_CV = 50_000;
const MAX_WHY = 500;

export async function POST(req: NextRequest) {
  if (declaresMoreThan(req, 100_000)) return payloadTooLarge();

  const caller = await signedIn();
  if (!caller) return unauthorized();

  const burst = await checkBurstLimit(caller.userId, "letter-smart", { limit: 20, windowSeconds: 60 });
  if (!burst.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again.", errorType: "burst_limit" },
      { status: 429 },
    );
  }

  const body = await readJsonBody(req);
  if (!body) return invalidBody();

  const cvText = typeof body.cvText === "string" ? body.cvText.slice(0, MAX_CV) : "";
  const roleTitle = typeof body.roleTitle === "string" ? body.roleTitle.slice(0, 100) : "";
  const companyName = typeof body.companyName === "string" ? body.companyName.slice(0, 100) : "";
  const profileName = typeof body.profileName === "string" ? body.profileName.slice(0, 100) : "";
  const whyCompany = typeof body.whyCompany === "string" ? body.whyCompany.slice(0, MAX_WHY) : null;
  const rtwStatement = typeof body.rtwStatement === "string" ? body.rtwStatement : null;
  const template: "corporate" | "founder" = body.template === "founder" ? "founder" : "corporate";

  if (!cvText.trim()) {
    return NextResponse.json({ error: "Your main CV is missing." }, { status: 400 });
  }
  if (!roleTitle.trim()) {
    return NextResponse.json({ error: "Role title is required." }, { status: 400 });
  }
  if (!companyName.trim()) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }

  const rawIds = Array.isArray(body.evidenceIds) ? body.evidenceIds : [];
  const evidenceIds = rawIds
    .filter((id: unknown): id is string => typeof id === "string")
    .slice(0, 5);

  // Parse the CV to find the actual bullet texts for the given IDs
  const roles = parseMasterExperience(cvText);

  // Parse a role header "Title | Employer | Dates" or "Title — Employer\tDates"
  function parseHeader(header: string): { title: string; employer: string } {
    const parts = header.split(/\s*\|\s*|\s*[—–]\s+/);
    if (parts.length >= 2) {
      return { title: parts[0].trim(), employer: parts[1].trim() };
    }
    return { title: header.trim(), employer: "" };
  }

  const bulletMap = new Map<string, { text: string; roleTitle: string; employer: string }>();
  for (const role of roles) {
    const { title, employer } = parseHeader(role.header);
    for (const b of role.bullets) {
      bulletMap.set(b.id, { text: b.text, roleTitle: title, employer });
    }
  }

  // Build evidence sources from the requested IDs (top 3 max)
  const evidence: EvidenceSource[] = evidenceIds
    .slice(0, 3)
    .map((id) => {
      const found = bulletMap.get(id);
      if (!found) return null;
      return {
        id,
        bulletText: found.text,
        roleTitle: found.roleTitle,
        employer: found.employer,
      };
    })
    .filter((e): e is EvidenceSource => e !== null);

  const result = buildLetterFromEvidence({
    profileName: profileName || "Candidate",
    roleTitle,
    companyName,
    evidence,
    cvText,
    whyCompany: whyCompany || null,
    rtwStatement: rtwStatement || null,
    template,
  });

  return NextResponse.json({
    letter: result.letter,
    sentences: result.sentences,
    rejectedIds: result.rejectedIds,
    isFreeMatch: true,
  });
}
