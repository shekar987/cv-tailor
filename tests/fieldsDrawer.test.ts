// Chunk 35: the Agent page's "Fields" drawer renders the observer JSON the PC
// worker recorded (label, type, required, options, which frame), the wall
// notice, and the screenshot. The .tsx loads through tests/support/tsxLoader.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FieldsDrawer, type ObserverData } from "../src/app/agent/FieldsDrawer.tsx";

const observer: ObserverData = {
  url: "https://boards.greenhouse.io/acme/jobs/123",
  title: "Apply: Software Engineer — Acme Robotics",
  login_wall: false,
  captcha: false,
  wall_reason: null,
  counts: { textbox: 5, combobox: 1, radiogroup: 1, file: 1, checkbox: 1, button: 1 },
  field_count: 10,
  truncated: false,
  elements: [
    { index: 0, role: "textbox", type: "text", label: "First name *", name: "first", required: true },
    { index: 1, role: "file", type: "file", label: "Resume/CV *", name: "resume", required: true },
    {
      index: 2,
      role: "combobox",
      type: null,
      label: "Where are you based? *",
      name: "location",
      required: true,
      options: [{ value: "london", label: "London" }, { value: "remote", label: "Remote" }],
    },
    { index: 3, role: "radiogroup", type: "radio", label: "How did you hear about us? *", required: true, frame_path: "https://boards.greenhouse.io/embed" },
    { index: 4, role: "button", type: "submit", label: "Submit application" },
  ],
};

test("renders the numbered field list with label, type and required", () => {
  const html = renderToStaticMarkup(createElement(FieldsDrawer, { observer }));
  assert.match(html, /data-fields-drawer/);
  assert.match(html, /10 fields found/);
  assert.match(html, /First name \*/);
  assert.match(html, /Resume\/CV \*/);
  assert.match(html, /Submit application/);
  // The meta line carries role · type · required.
  assert.match(html, /textbox · text · required/);
  assert.match(html, /file · file · required/);
  // The select shows its option count; the radio group says it is in a frame.
  assert.match(html, /combobox.*2 options/);
  assert.match(html, /in an embedded frame/);
  // Every element is numbered via data-field-index.
  assert.match(html, /data-field-index="0"/);
  assert.match(html, /data-field-index="4"/);
});

test("shows a login-wall notice when flagged", () => {
  const walled: ObserverData = { ...observer, login_wall: true, wall_reason: "Paused — this page has a password field (sign-in). A human needs to take over." };
  const html = renderToStaticMarkup(createElement(FieldsDrawer, { observer: walled }));
  assert.match(html, /data-fields-wall/);
  assert.match(html, /sign-in/);
});

test("shows a captcha notice with no explicit reason", () => {
  const walled: ObserverData = { ...observer, captcha: true, wall_reason: null };
  const html = renderToStaticMarkup(createElement(FieldsDrawer, { observer: walled }));
  assert.match(html, /captcha/i);
});

test("renders the screenshot when a signed URL is given", () => {
  const html = renderToStaticMarkup(
    createElement(FieldsDrawer, { observer, screenshotUrl: "https://signed.example/page.png?token=abc" })
  );
  assert.match(html, /agentFields__shot/);
  assert.match(html, /signed\.example\/page\.png/);
});

test("says so when the worker has not observed yet", () => {
  const html = renderToStaticMarkup(createElement(FieldsDrawer, { observer: null }));
  assert.match(html, /data-fields-empty/);
  assert.match(html, /read this page/);
});

test("notes when the list was truncated", () => {
  const big: ObserverData = { ...observer, field_count: 240, truncated: true };
  const html = renderToStaticMarkup(createElement(FieldsDrawer, { observer: big }));
  assert.match(html, /240 fields found \(showing the first 5\)/);
});
