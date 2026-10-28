// HTML job descriptions → the plain text the JD box takes. Import-free
// (tests/): list items on their own lines as "- " (nested items indented two
// spaces a level), paragraphs and headings separated by one blank line, <br>
// a line break, entities decoded, no tag left.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  zwj: "",
  zwnj: "",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  pound: "£",
  euro: "€",
  dollar: "$",
  cent: "¢",
  yen: "¥",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  laquo: "«",
  raquo: "»",
  rarr: "→",
  larr: "←",
  check: "✓",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  agrave: "à",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  szlig: "ß",
};

function codePoint(n: number): string {
  // A control character or an out-of-range number is not text.
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n < 32 && n !== 9 && n !== 10) || (n >= 0xd800 && n <= 0xdfff)) return "";
  return n === 0xa0 ? " " : String.fromCodePoint(n);
}

/** One level of HTML entities decoded ("&amp;lt;" → "&lt;", never further). */
export function decodeEntities(s: string): string {
  return (s || "").replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      return codePoint(body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1)));
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

const REAL_TAG_RE = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;
const ESCAPED_TAG_RE = /&(?:amp;)*lt;\/?[a-z][a-z0-9]*\b/i;

/**
 * HTML that arrives entity-escaped (Greenhouse's `content`: "&lt;p&gt;…",
 * sometimes twice over: "&amp;lt;li&amp;gt;") unescaped until real tags
 * appear — at most three levels. Text that already has tags is left as it is.
 */
export function unescapeHtml(s: string): string {
  let out = s || "";
  for (let i = 0; i < 3 && !REAL_TAG_RE.test(out) && ESCAPED_TAG_RE.test(out); i++) out = decodeEntities(out);
  return out;
}

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr", "pre", "figure", "dl", "dt", "dd", "hr",
]);
const LIST_TAGS = new Set(["ul", "ol"]);
const DROP_RE = /<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>/gi;

/** HTML → plain text in the shape described at the top of this file. */
export function htmlToPlainText(html: string): string {
  const source = (html || "").replace(DROP_RE, " ");
  const lines: string[] = [];
  let current = "";
  let prefix = ""; // the bullet the current line opened with
  let depth = 0;

  const hasText = () => current.length > prefix.length;
  const newline = () => {
    if (!hasText()) return; // an open bullet waits for its text
    lines.push(current.trimEnd());
    current = "";
    prefix = "";
  };
  const blankLine = () => {
    newline();
    if (current === "" && lines.length && lines[lines.length - 1] !== "") lines.push("");
  };
  const append = (text: string) => {
    const t = decodeEntities(text).replace(/[\s\u00a0]+/g, " ");
    if (!t.trim()) {
      if (hasText() && !current.endsWith(" ")) current += " ";
      return;
    }
    current += hasText() ? t : t.trimStart();
  };
  let inItem = 0; // open <li> elements: Lever's lists arrive as bare <li>s

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[4] !== undefined || m[5] !== undefined) {
      append(m[4] ?? m[5]);
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") {
      if (hasText()) {
        lines.push(current.trimEnd());
        current = "";
        prefix = "";
      }
      continue;
    }
    if (LIST_TAGS.has(tag)) {
      if (closing) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) blankLine();
        else newline();
      } else {
        if (depth === 0) blankLine();
        else newline();
        depth++;
      }
      continue;
    }
    if (tag === "li") {
      newline();
      inItem = Math.max(0, inItem + (closing ? -1 : 1));
      if (!closing) {
        current = `${"  ".repeat(Math.max(depth, 1) - 1)}- `;
        prefix = current;
      }
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      if (depth > 0 || inItem > 0) newline();
      else blankLine();
    }
    // Inline tags (strong, em, span, a …) carry no break.
  }
  newline();
  return tidyPlainText(lines.join("\n"));
}

/**
 * Plain text tidied: bullets written as •, ·, ▪, * or – become "- ", spaces
 * collapse inside a line (a bullet's indent kept), runs of blank lines become
 * one, empty bullets go.
 */
export function tidyPlainText(text: string): string {
  const out: string[] = [];
  for (const raw of (text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/[\t\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ").trimEnd();
    const bullet = /^(\s*)[-*\u2022\u00b7\u25aa\u25e6\u25cf\u2013](?:\s+(.*))?$/.exec(line);
    let clean: string;
    if (bullet) {
      const body = (bullet[2] ?? "").replace(/ {2,}/g, " ").trim();
      if (!body) continue;
      const indent = "  ".repeat(Math.min(3, Math.floor(bullet[1].length / 2)));
      clean = `${indent}- ${body}`;
    } else {
      clean = line.replace(/ {2,}/g, " ").trim();
    }
    if (!clean && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(clean);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** Text cut to `max` characters at the last line break that keeps most of it. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf("\n");
  return (at >= max * 0.8 ? cut.slice(0, at) : cut).trimEnd();
}
