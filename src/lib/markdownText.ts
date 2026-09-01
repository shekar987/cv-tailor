// Inline-markdown handling shared by all three CV renderers and the master-CV
// save path. Two jobs, kept together because they must agree on syntax:
//
// 1. parseBoldSegments(): the **bold** contract between the pipeline and the
//    renderers. The experience prompt asks the model to bold quantified wins
//    with **; the preview renders those as <strong>, the .docx as bold
//    TextRuns, and the PDF as bold draws. Spans may cover MULTIPLE words, so
//    parsing must happen BEFORE any whitespace tokenization — the old
//    per-token parsing bolded only single words and leaked literal asterisks
//    around phrases.
//
// 2. stripMarkdown(): save-time cleanup for a master CV pasted from a
//    markdown file. CV text is plain text everywhere downstream (prompts
//    quote it, extraction captures it verbatim), so markdown syntax that
//    survives a save leaks literal **/[label](url) into every output. Bold
//    markers are dropped (the tailoring step re-bolds what matters), links
//    become readable text, heading markers go.
//
// Dependency-free on purpose — imported by client components and server libs.

export type InlineSegment = { text: string; bold: boolean };

const BOLD_SPAN = /(\*\*[^*\n]+?\*\*)/g;

export function parseBoldSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  for (const part of (text || "").split(BOLD_SPAN)) {
    if (part === "") continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      segments.push({ text: part.slice(2, -2), bold: true });
    } else {
      segments.push({ text: part, bold: false });
    }
  }
  return segments;
}

// [label](target) → readable plain text. mailto targets collapse to the bare
// address; a label that just repeats the URL collapses to the URL; anything
// else keeps both as "label: target".
const MD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

export function stripMarkdown(text: string): string {
  let out = (text || "").replace(/\r\n?/g, "\n");

  out = out.replace(MD_LINK, (_match, label: string, target: string) => {
    const cleanLabel = label.trim();
    const t = target.trim();
    if (/^mailto:/i.test(t)) return t.replace(/^mailto:/i, "");
    if (normalizeForCompare(cleanLabel) === normalizeForCompare(t)) return t;
    return `${cleanLabel}: ${t}`;
  });

  return out
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "") // heading markers
        .replace(/\*\*([^*\n]+?)\*\*/g, "$1") // **bold**
        .replace(/(^|\s)\*([^*\s][^*\n]*?)\*(?=[\s.,;:!?)]|$)/g, "$1$2") // *italic*
        .replace(/`([^`\n]+)`/g, "$1") // `code`
        .replace(/[ \t]{2,}/g, "  ") // whitespace walls (markdown right-padding)
        .replace(/[ \t]+$/, "")
    )
    .join("\n");
}
