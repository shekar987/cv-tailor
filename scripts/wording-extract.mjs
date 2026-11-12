// Lists the user-facing strings of the given source files as JSON, read with the
// TypeScript parser (never a regex over the source): JSX text, the text props of
// elements (title, aria-label, placeholder ...) and sentence-like string literals
// in the component bodies (errors, notices, confirm questions).
//
//   node scripts/wording-extract.mjs <file ...>  > strings.json
//
// docs/wording-audit.md (Chunk 25) was built from its output.
import ts from "typescript";
import { readFileSync } from "node:fs";

const SKIP_ATTRS = new Set([
  "className", "id", "href", "type", "name", "key", "style", "role", "htmlFor", "viewBox", "d",
  "fill", "stroke", "src", "rel", "target", "variant", "size", "icon", "as", "autoComplete",
  "inputMode", "method", "action", "accept", "lang", "dir", "kind", "tone", "width", "height",
  "strokeWidth", "strokeLinecap", "strokeLinejoin", "xmlns", "points", "cx", "cy", "r", "x", "y",
  "x1", "x2", "y1", "y2", "rx", "ry", "transform", "align", "valign", "scope", "wrap", "folio",
  "sectionId", "value", "defaultValue", "pattern", "step", "min", "max", "form", "media", "sizes",
  "loading", "decoding", "tabIndex", "spellCheck", "dataKey", "nameKey", "format",
]);
const SKIP_CALLS = /^(console\.|fetch$|api$|trackedFetch$|require$|import$|.*\.(get|set|has|delete|append|getItem|setItem|removeItem|querySelector|querySelectorAll|closest|matches|getAttribute|setAttribute|removeAttribute|addEventListener|removeEventListener|includes|startsWith|endsWith|indexOf|split|join|replace|replaceAll|match|test|from|select|eq|neq|in|order|rpc|push|replaceState|pushState|createElement|getElementById|contains|add|remove|toggle|toLocaleDateString|toLocaleString|localeCompare|padStart|padEnd)$)/;

function sentenceLike(s) {
  const t = s.trim();
  if (t.length < 2 || !/[A-Za-z]/.test(t)) return false;
  if (/^(https?:|\/|#|\.|@|--|data-|aria-)/.test(t) && !/\s/.test(t)) return false;
  if (!/\s/.test(t)) return false; // one word outside JSX: a key, a status, a class
  if (/^[a-z0-9_\-:.\s]+$/.test(t) && !/[.?!]$/.test(t)) return false; // class lists, keys
  if (/^(use client|use server|use strict)$/.test(t)) return false;
  return true;
}

function textOf(node, sf) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) out += "{" + span.expression.getText(sf).replace(/\s+/g, " ").slice(0, 40) + "}" + span.literal.text;
    return out;
  }
  return "";
}

function enclosing(node) {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer) || ts.isCallExpression(n.initializer)) && ts.isIdentifier(n.name)) return n.name.text;
  }
  return "";
}

function jsxHost(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isJsxElement(n)) return n.openingElement.tagName.getText();
    if (ts.isJsxSelfClosingElement(n)) return n.tagName.getText();
  }
  return "";
}

function hostClass(node, sf) {
  for (let n = node.parent; n; n = n.parent) {
    const open = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (!open) continue;
    for (const a of open.attributes.properties) {
      if (ts.isJsxAttribute(a) && a.name.getText() === "className" && a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text.split(/\s+/)[0];
    }
    return "";
  }
  return "";
}

const out = [];
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const push = (node, text, kind) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    out.push({ file: file.replace(/\\/g, "/"), line, text: clean, kind, fn: enclosing(node), tag: jsxHost(node), cls: hostClass(node, sf) });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxText(node)) {
      if (/[A-Za-z]/.test(node.text)) push(node, node.text, "text");
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      if (SKIP_ATTRS.has(name) || name.startsWith("data-") || /^on[A-Z]/.test(name)) {
        // an event handler may still hold a message: walk it, but never a plain value
        if (/^on[A-Z]/.test(name) && node.initializer) ts.forEachChild(node.initializer, visit);
        return;
      }
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) {
        if (/[A-Za-z]/.test(init.text)) push(init, init.text, "prop:" + name);
        return;
      }
      if (init) ts.forEachChild(init, (c) => visitExpr(c, "prop:" + name));
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression) visitExpr(node.expression, "text");
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (skipByParent(node, sf)) return;
      const t = textOf(node, sf);
      if (sentenceLike(t)) push(node, t, "code");
      // A one-word value in a table of labels ({ ghosted: "Ghosted" }, { label: "Actions" }).
      else if (ts.isPropertyAssignment(node.parent) && node.parent.initializer === node && /^[A-Z][a-z][A-Za-z'’-]*$/.test(t.trim())) push(node, t, "label");
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  // Inside JSX a single word counts ("Save"), except where it is compared or used as a key.
  const visitExpr = (node, kind) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (skipByParent(node, sf)) return;
      const t = textOf(node, sf);
      if (/[A-Za-z]{2}/.test(t) && !/^[a-z][A-Za-z0-9_-]*$/.test(t.trim())) push(node, t, kind);
      else if (sentenceLike(t)) push(node, t, kind);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visitExpr(s.expression, kind));
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return visit(node);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return ts.forEachChild(node, visit);
    ts.forEachChild(node, (c) => visitExpr(c, kind));
  };
  visit(sf);
}

function skipByParent(node, sf) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(op)) return true;
  }
  if (ts.isCaseClause(p) || ts.isElementAccessExpression(p) || ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertyAssignment(p) && /^(className|id|href|key|type|method|credentials|cache|mode|behavior|block|inline|kind|variant|icon|event|path|url|bucket|source)$/.test(p.name.getText(sf))) return true;
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const callee = p.expression.getText(sf).replace(/\s+/g, "");
    if (SKIP_CALLS.test(callee)) return true;
    if (ts.isNewExpression(p) && /^(RegExp|URL|Intl\.)/.test(callee)) return true;
  }
  return false;
}

process.stdout.write(JSON.stringify(out, null, 1));
