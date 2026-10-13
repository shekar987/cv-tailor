// The hero shader's colours, read from the CSS tokens at run time so the
// canvas can never drift off the palette. Import-free (tests/).

export type Rgb = [number, number, number];

/** Token name per shader colour. Values are 0..1 floats for the GPU. */
export const HERO_TOKENS = {
  bg: "--bg",
  desk: "--lp-desk",
  amber: "--amber",
  amberHi: "--amber-bright",
  paper: "--doc-paper",
} as const;

export type HeroPalette = Record<keyof typeof HERO_TOKENS, Rgb>;

// The tokens' values when a token is missing or unreadable — the same hexes
// globals.css declares, so a fallback is the palette, not a guess.
const FALLBACK: HeroPalette = {
  bg: [14 / 255, 14 / 255, 16 / 255],
  desk: [20 / 255, 20 / 255, 22 / 255],
  amber: [224 / 255, 160 / 255, 77 / 255],
  amberHi: [245 / 255, 193 / 255, 108 / 255],
  paper: [1, 1, 1],
};

/** `#rgb`, `#rrggbb`, `rgb(r, g, b)` or `rgba(r, g, b, a)` → 0..1 floats; anything else null. */
export function parseCssColor(value: string): Rgb | null {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    const c = [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Math.max(0, Number(n))) / 255);
    return c as Rgb;
  }
  return null;
}

/** Reads every shader colour through `get` (a computed-style getter in the browser). */
export function readHeroPalette(get: (name: string) => string): HeroPalette {
  const out = { ...FALLBACK };
  for (const key of Object.keys(HERO_TOKENS) as (keyof typeof HERO_TOKENS)[]) {
    const parsed = parseCssColor(get(HERO_TOKENS[key]) ?? "");
    if (parsed) out[key] = parsed;
  }
  return out;
}
