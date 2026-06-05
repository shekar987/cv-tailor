import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const JD_ANALYZER_PROMPT = `You are a JD analyzer for a CV tailoring system. Extract structured data from the job description the user provides.

Output ONLY a JSON object (no prose, no markdown fences) with these fields:
{
  "role_title": "exact job title",
  "company_name": "company name",
  "seniority_level": "junior | mid | senior | staff | unspecified",
  "role_type": "backend | frontend | fullstack | ai_engineering | data_engineering | ml_engineering | devops | other",
  "location_and_mode": "e.g. London, Hybrid",
  "required_skills": ["top 10 mandatory skills, priority order"],
  "nice_to_have_skills": ["up to 8 preferred skills"],
  "top_15_ats_keywords": ["top 15 ATS keywords, priority ordered"],
  "company_values_and_culture": ["3-6 cultural signals"],
  "domain_context": "1 sentence on what the product does",
  "tone_signals": "formal | semi-formal | founder-casual | technical-dense"
}`;

export async function POST(req: NextRequest) {
  try {
    const { jobDescription } = await req.json();

    if (!jobDescription) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: JD_ANALYZER_PROMPT,
      messages: [{ role: "user", content: jobDescription }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    let responseText = textBlock && "text" in textBlock ? textBlock.text : "";

    // Strip markdown code fences if Claude added them
    responseText = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    // Validate it's actually parseable JSON before returning
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { error: "Model returned invalid JSON", raw: responseText },
        { status: 502 }
      );
    }

    return NextResponse.json({ result: parsed });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Failed to analyze JD" }, { status: 500 });
  }
}