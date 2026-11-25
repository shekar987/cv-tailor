# JH-5 — calmer "Interviews & deadlines" panel (24 Nov 2026)

Branch `jh-5-calm-interviews-panel`, from `main` (line 2 of BUILD-NEXT.txt). JH-4
(`jh-4-never-say-guard`) is **not** merged into main, but JH-5 only touches the JH-1
InterviewsPanel, which is on main, so starting from main is correct and independent of JH-4.

## Step 0 — how far down the table started (before)

No Playwright/Edge-driven harness runs in the build sandbox, so this was measured from a
faithful static render (the old markup + the globals.css from `main`) at 375px, with a
375×667 phone fold drawn in.

- 9 panel items, each with the sub-line + 2–3 buttons.
- The "Applications table starts here" marker lands at **≈1700px** down — about **2.5 screen
  heights below the 667px fold**. The table's first row was invisible without scrolling.
  (`screenshots/jh5-panel-before-mobile.png`.)

## After

- At most **3 items** by default, with **Show all (9) / Show fewer**.
- Sub-line removed (title + count only).
- One main action per item: the item links to the **Prep pack**. "Move to <stage>" stays
  visible only when the row is behind the booking; "Add to calendar" is behind one
  keyboard-reachable **More** disclosure per item.
- Mobile: main line = kind · company · countdown (the one tap target); Move/More drop to a
  compact row below — no overlap, no wrapped 3-button rows. Touch targets 44px (pointer:coarse).
- Countdown uses `--text-subtle` (#CCC7BF on #202024 → well above WCAG AA); overdue → `--danger`.

The table marker now lands at **≈430px on mobile** and **≈290px on desktop** — comfortably
within the first screen. (`screenshots/jh5-panel-after-mobile.png`, `-after-desktop.png`.)

## Reproduce

```
node --import ./tests/support/tsxLoader.mjs audit/2026-11-24/panel-shots.mjs
```

Renders the REAL new component (via the tsx loader) and the OLD panel (markup + main's
globals.css) with the same 9 made-up items, then screenshots with the local Edge/Chrome.
The owner's live-API browser harness is `scripts/e2e-followups-interviews.mjs` (updated for
the collapsed-by-default behaviour).

> Note: the chunk's preferred location is `RTS\jobhuntz-audit\2026-11-24\screenshots\`. These
> are committed under `cv-tailor/audit/2026-11-24/` so they travel with the branch for review;
> re-run the harness to also write into jobhuntz-audit if wanted.
