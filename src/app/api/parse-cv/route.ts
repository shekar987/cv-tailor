import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { parseCvFile, CvParseError, MAX_FILE_BYTES } from "@/lib/parseCv";

// Parsing is CPU-bound and runs on untrusted input, so it gets a hard ceiling.
// A file that takes longer than this is either pathological or adversarial.
const PARSE_TIMEOUT_MS = 20_000;

// 'nodejs' is already the Next 16 default; pinned explicitly because the PDF and
// DOCX parsers need Node APIs (Buffer) and would break on the Edge runtime.
export const runtime = "nodejs";

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new CvParseError("That file took too long to read. Try a smaller or simpler file.", "timeout")),
      ms
    );
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    // Same gate as the other routes: cheap rejection of floods before doing work.
    const burst = await checkBurstLimit(userId, "parse-cv");
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many uploads. Please wait ${burst.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    // Reject oversized bodies from the header before buffering them, so a huge
    // upload doesn't get read into memory just to be thrown away.
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_FILE_BYTES * 1.1) {
      return NextResponse.json(
        { error: "That file is larger than 5MB. Upload a smaller file." },
        { status: 400 }
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "That file is larger than 5MB. Upload a smaller file." },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, kind } = await withTimeout(parseCvFile(bytes, file.name || ""), PARSE_TIMEOUT_MS);

    // Only the text goes back to the client that uploaded it. Never logged.
    return NextResponse.json({ text, kind, characters: text.length });
  } catch (err) {
    if (err instanceof CvParseError) {
      // Expected, user-actionable outcomes. Log the code only — never the file
      // name, bytes, or extracted text.
      console.warn("CV parse rejected:", err.code);
      const status = err.code === "timeout" ? 408 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("CV parse error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json(
      { error: "Could not read that file. Please paste your CV text instead." },
      { status: 500 }
    );
  }
}
