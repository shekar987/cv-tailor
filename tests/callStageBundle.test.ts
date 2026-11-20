// Chunk 30, item 7: the default interview page must not download TalkingHead,
// three or a .glb. Checked on the import graph, which is what decides the
// bundle: neither page.tsx nor anything it imports statically may pull in the
// vendored TalkingHead (which imports three), and AvatarStage may load it only
// through a dynamic import() inside its effect. Verified against a real build
// on 20 Nov 2026: the page's client chunks hold no WebGLRenderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dir = path.join("src", "app", "applications", "[id]", "interview");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
const staticImports = (src: string) =>
  [...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

test("the interview page and its stages import no 3D module statically", () => {
  for (const f of ["page.tsx", "CallStage.tsx", "InterviewRoom.tsx"]) {
    for (const spec of staticImports(read(f))) {
      assert.doesNotMatch(spec, /talkinghead|^three(\/|$)|\.glb$/i, `${f} imports ${spec}`);
    }
  }
});

test("AvatarStage loads TalkingHead only through a dynamic import", () => {
  const src = read("AvatarStage.tsx");
  for (const spec of staticImports(src)) {
    assert.doesNotMatch(spec, /talkinghead|^three(\/|$)/i, `AvatarStage imports ${spec} statically`);
  }
  assert.match(src, /import\(\s*["']@\/vendor\/talkinghead\/talkinghead\.mjs["']\s*\)/);
});

test("the 3D avatar is mounted only when the 3D view is chosen", () => {
  const src = read("page.tsx");
  assert.match(src, /view === "3d" \? \(\s*(\/\/[^\n]*\n\s*)*<AvatarStage/);
});
