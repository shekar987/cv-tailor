// Unit tests for the uploaded "CV you sent" per application (lib/sentCv). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayFileName,
  storageFileName,
  sentCvPath,
  ownsPath,
  contentDisposition,
  contentTypeFor,
  normalizeSentCv,
  publicSentCv,
  formatFileSize,
  textNoteFor,
  MAX_SENT_CV_TEXT,
} from "../src/lib/sentCv.ts";

const USER = "1d4274a9-8a87-4a6e-8545-46ab8f680578";
const APP = "0b6f2c7e-3a51-4c1d-9d2e-5f0a1b2c3d4e";

test("displayFileName: the user's own name, with the extension its content has", () => {
  assert.equal(displayFileName("Shekar Keesari CV.pdf", "pdf"), "Shekar Keesari CV.pdf");
  assert.equal(displayFileName("CV (Monzo).PDF", "pdf"), "CV (Monzo).pdf");
  assert.equal(displayFileName("resume.docx", "docx"), "resume.docx");
  assert.equal(displayFileName("resume.pdf", "docx"), "resume.docx", "named .pdf but really a Word file");
  assert.equal(displayFileName("../../etc/passwd", "txt"), "..-..-etc-passwd.txt", "no path separators");
  assert.equal(displayFileName("bad\u0000name\n.pdf", "pdf"), "badname.pdf");
  assert.equal(displayFileName("", "pdf"), "CV.pdf");
  assert.equal(displayFileName(undefined, "txt"), "CV.txt");
  assert.ok(displayFileName("x".repeat(500) + ".pdf", "pdf").length <= 124);
});

test("storageFileName: a plain key — no spaces, accents or separators", () => {
  assert.equal(storageFileName("Shekar Keesari CV.pdf", "pdf"), "Shekar-Keesari-CV.pdf");
  assert.equal(storageFileName("Résumé – Zoë.docx", "docx"), "Resume-Zoe.docx");
  assert.equal(storageFileName("../../secret", "pdf"), "secret.pdf");
  assert.equal(storageFileName("简历.pdf", "pdf"), "cv.pdf");
  assert.match(storageFileName("a".repeat(300), "txt"), /^a{60}\.txt$/);
});

test("sentCvPath / ownsPath: inside the user's own folder for that application", () => {
  const path = sentCvPath(USER, APP, "My CV.pdf", "pdf", 1790400000000);
  assert.equal(path, `${USER}/${APP}/1790400000000-My-CV.pdf`);
  assert.equal(ownsPath(path, USER, APP), true);
  assert.equal(ownsPath(path, "someone-else", APP), false);
  assert.equal(ownsPath(path, USER, "another-application"), false);
  assert.equal(ownsPath(`${USER}/${APP}/../other/x.pdf`, USER, APP), false);
  assert.equal(ownsPath(`${USER}/${APP}/./x.pdf`, USER, APP), false);
  assert.equal(ownsPath(null, USER, APP), false);
});

test("contentDisposition: always an attachment, UTF-8 name preserved", () => {
  assert.equal(contentDisposition("My CV.pdf"), `attachment; filename="My CV.pdf"; filename*=UTF-8''My%20CV.pdf`);
  const accented = contentDisposition('Zoë "CV".pdf');
  assert.match(accented, /^attachment; filename="Zoe _CV_\.pdf"; filename\*=UTF-8''/);
  assert.ok(accented.includes(encodeURIComponent('Zoë "CV".pdf')));
});

test("contentTypeFor: the three kinds the bucket accepts", () => {
  assert.equal(contentTypeFor("pdf"), "application/pdf");
  assert.equal(contentTypeFor("docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(contentTypeFor("txt"), "text/plain");
});

test("normalizeSentCv: bounded on read; the path never reaches the client", () => {
  const stored = {
    version: 1,
    path: `${USER}/${APP}/1-My-CV.pdf`,
    fileName: "My CV.pdf",
    size: 212_345.4,
    kind: "pdf",
    uploadedAt: "2026-09-27T10:00:00.000Z",
    text: "x".repeat(MAX_SENT_CV_TEXT + 50),
  };
  const s = normalizeSentCv(stored)!;
  assert.equal(s.size, 212_345);
  assert.equal(s.text.length, MAX_SENT_CV_TEXT);
  assert.equal(s.textNote, undefined);
  const info = publicSentCv(s)!;
  assert.equal("path" in info, false);
  assert.equal(info.fileName, "My CV.pdf");
  assert.equal(normalizeSentCv(null), null);
  assert.equal(normalizeSentCv({ ...stored, kind: "exe" }), null);
  assert.equal(normalizeSentCv({ ...stored, path: "" }), null);
  assert.equal(normalizeSentCv({ ...stored, uploadedAt: "yesterday" })!.uploadedAt, "");
  assert.equal(normalizeSentCv({ ...stored, text: "", textNote: textNoteFor("no_text_layer") })!.textNote, textNoteFor("no_text_layer"));
  assert.equal(publicSentCv(null), null);
});

test("formatFileSize / textNoteFor", () => {
  assert.equal(formatFileSize(212_345), "207 KB");
  assert.equal(formatFileSize(300), "1 KB");
  assert.equal(formatFileSize(1_500_000), "1.4 MB");
  assert.equal(formatFileSize(0), "0 KB");
  assert.match(textNoteFor("no_text_layer"), /scanned/);
  assert.match(textNoteFor("whatever"), /couldn't be read/);
});
