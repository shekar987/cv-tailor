import { NextResponse } from "next/server";
import { checkContact, contactBlockMessage } from "@/lib/contactCheck";

// The server's half of lib/contactCheck: /api/tailor and both CV download
// routes refuse a profile whose contact details are not addresses, with the
// same sentence /app shows. 422 — the request is well formed, its data is not
// usable — and nothing is metered or built.
export function contactRefusal(profile: unknown): NextResponse | null {
  const problems = checkContact(profile as Parameters<typeof checkContact>[0]);
  if (problems.length === 0) return null;
  return NextResponse.json(
    { error: contactBlockMessage(problems), errorType: "contact_invalid", fields: problems.map((p) => p.field) },
    { status: 422 }
  );
}
