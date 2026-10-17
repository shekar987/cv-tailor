// The format styles (16 Oct 2026). Server-side entry: the full FormatStyle
// objects with their prompt blocks. Pages import ./ids.ts instead.
export * from "./ids.ts";
export type { FormatStyle, SummaryFormCtx, LetterPromptFn } from "./types.ts";
export { UKJI } from "./ukji.ts";
export { CAREERSET } from "./careerset.ts";
import type { FormatStyleId } from "./ids.ts";
import type { FormatStyle } from "./types.ts";
import { UKJI } from "./ukji.ts";
import { CAREERSET } from "./careerset.ts";

export const FORMAT_STYLES: Record<FormatStyleId, FormatStyle> = { ukji: UKJI, careerset: CAREERSET };

export function styleFor(id: FormatStyleId): FormatStyle {
  return FORMAT_STYLES[id];
}
