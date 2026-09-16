import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The social-share card for every page. Drawn in code so it never drifts from
// the brand; NotoSans-Bold is the same face the PDFs embed.

export const runtime = "nodejs";
export const alt = "Jobhuntz — honest CV tailoring";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  let fonts: { name: string; data: Buffer; weight: 700; style: "normal" }[] | undefined;
  try {
    const bold = readFileSync(join(process.cwd(), "src", "lib", "fonts", "NotoSans-Bold.ttf"));
    fonts = [{ name: "NotoSans", data: bold, weight: 700, style: "normal" }];
  } catch {
    fonts = undefined; // system fallback still renders a correct card
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#0E0E10",
          color: "#EDEDED",
          fontFamily: fonts ? "NotoSans" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: "#E0A04D", marginBottom: 32 }}>
          Jobhuntz
        </div>
        <div style={{ display: "flex", fontSize: 74, fontWeight: 700, lineHeight: 1.1, maxWidth: 1020 }}>
          Every AI CV tool lies for you. This one won't.
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#9B9BA2", marginTop: 36, maxWidth: 900 }}>
          Honest tailoring — every claim traces back to your real CV.
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
