import { test } from "node:test";
import assert from "node:assert/strict";
import { HERO_TOKENS, parseCssColor, readHeroPalette } from "../src/lib/landing/heroPalette.ts";

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test("parseCssColor reads six- and three-digit hex", () => {
  assert.ok(close(parseCssColor("#E0A04D")!, [224 / 255, 160 / 255, 77 / 255]));
  assert.ok(close(parseCssColor("  #fff ")!, [1, 1, 1]));
  assert.ok(close(parseCssColor("#0E0E10")!, [14 / 255, 14 / 255, 16 / 255]));
});

test("parseCssColor reads rgb() and rgba(), ignoring the alpha", () => {
  assert.ok(close(parseCssColor("rgb(20, 20, 22)")!, [20 / 255, 20 / 255, 22 / 255]));
  assert.ok(close(parseCssColor("rgba(224, 160, 77, 0.13)")!, [224 / 255, 160 / 255, 77 / 255]));
});

test("parseCssColor refuses anything else", () => {
  assert.equal(parseCssColor(""), null);
  assert.equal(parseCssColor("var(--amber)"), null);
  assert.equal(parseCssColor("amber"), null);
  assert.equal(parseCssColor("#GGGGGG"), null);
});

test("readHeroPalette takes every token it can read and falls back per token", () => {
  const values: Record<string, string> = {
    "--bg": "#000000",
    "--lp-desk": "rgb(30, 30, 33)",
    "--amber": "not a colour",
    "--doc-paper": "#fff",
  };
  const pal = readHeroPalette((name) => values[name] ?? "");
  assert.ok(close(pal.bg, [0, 0, 0]));
  assert.ok(close(pal.desk, [30 / 255, 30 / 255, 33 / 255]));
  assert.ok(close(pal.amber, [224 / 255, 160 / 255, 77 / 255]), "an unreadable token keeps the palette's own value");
  assert.ok(close(pal.amberHi, [245 / 255, 193 / 255, 108 / 255]), "a missing token keeps the palette's own value");
  assert.ok(close(pal.paper, [1, 1, 1]));
  assert.deepEqual(Object.keys(pal).sort(), Object.keys(HERO_TOKENS).sort());
});
