// Account-level actions shared by the Settings page and /api/account/*.
// The phrase a user types to delete their account; checked on both sides.
export const DELETE_CONFIRM_PHRASE = "delete my account";

/**
 * An account export as text chunks, one row of `applications` at a time, so the
 * route can stream it: with every tailored CV snapshot it passes Vercel's 4.5 MB
 * limit on a buffered response (4.35 MB for the tracker alone on 1,016 rows).
 */
const STREAMED_KEYS = new Set(["applications", "notesHistory"]);

export function* accountExportChunks(payload: Record<string, unknown>): Generator<string> {
  yield "{\n";
  const keys = Object.keys(payload);
  for (const [i, key] of keys.entries()) {
    const value = payload[key] as { rows?: unknown } | undefined;
    const tail = i < keys.length - 1 ? ",\n" : "\n";
    // The tables that grow with use go out a row at a time (the tracker, every notes version).
    if (STREAMED_KEYS.has(key) && Array.isArray(value?.rows)) {
      const { rows, ...rest } = value as { rows: unknown[] };
      yield `${JSON.stringify(key)}: {`;
      for (const [k, v] of Object.entries(rest)) yield `${JSON.stringify(k)}: ${JSON.stringify(v)}, `;
      yield '"rows": [\n';
      for (const [r, row] of rows.entries()) yield `${JSON.stringify(row)}${r < rows.length - 1 ? ",\n" : "\n"}`;
      yield `]}${tail}`;
    } else {
      yield `${JSON.stringify(key)}: ${JSON.stringify(value, null, 2)}${tail}`;
    }
  }
  yield "}\n";
}
