// Paste handler for the contentEditable previews. A paste from Word or a web
// page carries inline styles (white text, a different font) that would land
// inside the white CV document and render invisible or mismatched. Only the
// plain text is inserted, at the caret, as a single undoable edit.

import type { ClipboardEvent } from "react";

export function pastePlainText(e: ClipboardEvent<HTMLElement>) {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  if (!text) return;
  // execCommand is deprecated but remains the only way to insert text into a
  // contentEditable that keeps the browser's undo stack and caret intact.
  document.execCommand("insertText", false, text);
}
