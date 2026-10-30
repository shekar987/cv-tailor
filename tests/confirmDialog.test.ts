// The in-page confirm (components/ConfirmDialog + lib/confirm), which
// replaced window.confirm on 30 Oct 2026: the dialog renders as an accessible
// modal, and the question resolves true or false. The .tsx loads through
// tests/support/tsxLoader.mjs (npm test passes it with --import).
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createConfirmController, confirmKeyAction, trapFocusIndex } from "../src/lib/confirm.ts";
import { ConfirmDialog } from "../src/components/ConfirmDialog.tsx";

test("the dialog renders as a labelled modal with the question and two buttons", () => {
  const controller = createConfirmController();
  void controller.request({ title: "Replace the job description?", message: "The box already holds one.", confirmLabel: "Replace", cancelLabel: "Keep mine" });
  const request = controller.current();
  assert.ok(request);
  const html = renderToStaticMarkup(createElement(ConfirmDialog, { request, onAnswer: () => {} }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
  assert.ok(labelledBy && new RegExp(`<h2 id="${labelledBy}"[^>]*>Replace the job description\\?</h2>`).test(html), "the title labels the dialog");
  const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  assert.ok(describedBy && html.includes(`id="${describedBy}"`), "the message describes it");
  assert.match(html, /data-confirm-cancel[^>]*>Keep mine<\/button>/);
  assert.match(html, /class="cta"[^>]*data-confirm-ok[^>]*>Replace<\/button>/);
  controller.answer(false);
});

test("a danger question wears the danger button; no message, no describedby", () => {
  const controller = createConfirmController();
  void controller.request({ title: "Delete this row?", danger: true });
  const html = renderToStaticMarkup(createElement(ConfirmDialog, { request: controller.current()!, onAnswer: () => {} }));
  assert.match(html, /class="cta danger"/);
  assert.doesNotMatch(html, /aria-describedby/);
  assert.match(html, />OK<\/button>/, "the default labels");
  assert.match(html, />Cancel<\/button>/);
  controller.answer(false);
});

test("the question resolves true on confirm and false on cancel", async () => {
  const controller = createConfirmController();
  let changes = 0;
  const unsubscribe = controller.subscribe(() => changes++);

  const yes = controller.request({ title: "Replace?" });
  assert.equal(controller.current()?.title, "Replace?");
  controller.answer(true);
  assert.equal(await yes, true);
  assert.equal(controller.current(), null, "closed once answered");

  const no = controller.request({ title: "Replace?" });
  controller.answer(false);
  assert.equal(await no, false);

  controller.answer(true); // nothing open: a no-op
  assert.equal(changes, 4, "opened and closed twice");
  unsubscribe();
});

test("a second question cancels the first, never leaves it hanging", async () => {
  const controller = createConfirmController();
  const first = controller.request({ title: "First?" });
  const second = controller.request({ title: "Second?" });
  assert.equal(await first, false);
  assert.equal(controller.current()?.title, "Second?");
  controller.answer(true);
  assert.equal(await second, true);
});

test("keys: Escape cancels, Enter confirms unless a button has focus", () => {
  assert.equal(confirmKeyAction("Escape", false), "cancel");
  assert.equal(confirmKeyAction("Escape", true), "cancel");
  assert.equal(confirmKeyAction("Enter", false), "confirm");
  assert.equal(confirmKeyAction("Enter", true), null, "the focused button presses itself");
  assert.equal(confirmKeyAction("a", false), null);
});

test("the focus trap wraps both ways", () => {
  assert.equal(trapFocusIndex(0, 2, false), 1);
  assert.equal(trapFocusIndex(1, 2, false), 0);
  assert.equal(trapFocusIndex(0, 2, true), 1);
  assert.equal(trapFocusIndex(1, 2, true), 0);
  assert.equal(trapFocusIndex(-1, 2, false), 0, "from the panel itself");
  assert.equal(trapFocusIndex(-1, 2, true), 1);
  assert.equal(trapFocusIndex(0, 0, false), -1);
});
