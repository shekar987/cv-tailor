# Chunk 32 — queued for a later chunk

These two mock-interview feedback features were scoped out of Chunk 32 on purpose
(see `../../../CHUNK-32-PASTE-INTO-CLAUDE-CODE.md`, build item 6). Both are
**local-only and opt-in** — no video or audio ever leaves the device, in keeping
with the room's existing privacy promise (the browser only ever receives the
text of answers, never the audio).

- **Webcam eye-contact** via MediaPipe `FaceLandmarker` (local only, opt-in): a
  self-view camera already exists on the call tile (`page.tsx` `toggleSelfView`,
  the stream stays on the device). A later chunk could read gaze/head-pose from
  that same stream to flag "you looked away from the camera a lot", computed in
  the browser and never uploaded. Gate it behind the camera toggle and a clear
  consent line.
- **Pitch / monotone** via `pitchy`: read fundamental frequency from the mic
  monitor that Chunk 31/32 already runs (`InterviewRoom` reads the mic every
  frame for the VAD and the longest-pause stat), and report pitch variation as a
  delivery stat ("your delivery was quite flat"). Purely a number, like wpm —
  no audio stored or sent.

## Screenshot of the feedback page

`scripts/e2e-mock-feedback.mjs` renders the real feedback page (Chunk 32) in Edge
on a throwaway account, with the feedback built from the real
`lib/mockInterview` rules (fictional company, role and answers). Run after a
build:

```
npm run build && npx next start -p 3100
PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs \
OUT="C:/Users/shekar/Desktop/shekar/RTS/jobhuntz-audit/2026-11-15/screenshots/13-mock-feedback-desktop.png" \
node --disable-warning=ExperimentalWarning scripts/e2e-mock-feedback.mjs
```
