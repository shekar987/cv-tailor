// node:test strips types from .ts files but cannot read JSX, so a test that
// renders a component (tests/confirmDialog) loads its .tsx through the
// TypeScript compiler the project already has: no new dependency. Only .tsx
// files are touched; everything else loads exactly as before.
// Used by `npm test` (`--import ./tests/support/tsxLoader.mjs`).
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        allowImportingTsExtensions: true,
        rewriteRelativeImportExtensions: false,
        verbatimModuleSyntax: false,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
