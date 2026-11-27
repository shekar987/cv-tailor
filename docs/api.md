# Tracker API notes (for the sweep)

How to read and write the application tracker (`/api/applications`) from a
script. Everything is scoped to the signed-in user by Supabase RLS; a script
sends the session cookie. No endpoint here makes a model call.

## Reading the list — `GET /api/applications`

Returns `{ applications: [...], total, next }` and an `X-Total-Count` header on
every response. `total` is the count of matching rows; `next` is how to get the
rest (an offset, or `null` when there are no more). Rows carry the sheet's
fields — no job description (`has_job_description: true` instead), a 120-char
`notes_preview` with `notes_more: true` when there is more, and the status in
the API's capitalised spelling (`"Applied"`, `"Interview"`, …).

### Paging (Chunk JH-3, 22 Nov 2026)

| Query | Meaning |
|---|---|
| `GET /api/applications` | The whole list, up to 2,000 rows, with `total` and `next` (`null` unless the 2,000 cap was hit). Unchanged for existing callers. |
| `?limit=<n>` | One page of `n` rows. Default **200**, maximum **1000** (a larger value is capped, not rejected). |
| `?offset=<m>` | Skip the first `m` rows. Default 0. Presence of `limit` or `offset` switches on paging. |
| `?all=1` | The whole list regardless of `limit`/`offset`. |

Reading a whole tracker: request `?limit=1000`, then `?limit=1000&offset=1000`,
and so on until `next` is `null`. Shekar's ~1,560 rows come back in two pages.

```
GET /api/applications?limit=1000
→ { "applications": [ …1000 rows… ], "total": 1557, "next": 1000 }   X-Total-Count: 1557
GET /api/applications?limit=1000&offset=1000
→ { "applications": [ …557 rows… ], "total": 1557, "next": null }
```

### Filters (applied before paging)

- `?status=Interview` — case-insensitive, comma-separated for several
  (`?status=Interview,Screening`). Matches rows whichever spelling they are
  stored in (`interview` and `Interview`).
- `?company=Monzo` — company name contains (case-insensitive).
- `?q=platform` — company **or** role contains (case-insensitive).

A filter narrows `total` and the pages to the matching rows.

### Other read modes (unchanged)

- `?id=<uuid>` — one full record, with the job description, full notes and the
  CV snapshot. The `updated_at` here is the version a whole-notes replace must
  send as `if_updated_at`.
- `?lite=1` — a light list for automations (seven fields, filtered in the
  database): `q`, `since`, `status`, `due_by`, `limit` (default 200). Returns
  `{ applications, more }`.
- `?stage=<tab>&limit=<n>&cursor=<c>` — the page's cursor-paginated first paint
  (`{ applications, nextCursor }`); `limit` here defaults to 50, max 200.
- `?due=48h` — what is due in the next N hours (1–168).

## Writing

- One status spelling is stored. Send any spelling (`"Applied"`, `"applied"`,
  `"Interview"`); it is normalised to the lower-case key on write
  (lib/tracker `normaliseStatus`) and read back in the capitalised API spelling.
- Notes: never send the whole `notes` field from a list preview. Add a line
  with `append_note` (PUT or PATCH) — it is stamped and prepended in one
  statement and can never lose history. A whole `notes` replace needs
  `if_updated_at` from a fresh `?id=` read, or it is a 409 `stale_notes`.
- **`append_note` is capped at 1,000 characters** (raised from 500 on 22 Nov
  2026). Over the cap is a 400 whose body carries `{ field: "append_note",
  max: 1000, length }`; send the rest as a second note.
- A row that reached screening or later is never ended by a sweep: moving it to
  Rejected / Withdrawn / Ghosted answers 409 with `pendingOutcomeUrl`. Record
  it with `PATCH /api/applications/{id}/pending-outcome`; the user confirms.
- Send an `Idempotency-Key` header (a fresh UUID per intended write) so a retry
  after a timeout returns the first answer instead of writing twice.

---

## POST /api/check/outreach (JH-7, 26 Nov 2026)

Checks an outreach message (follow-up, cold email, DM or letter) for honesty
issues before it is sent. No model call, no credit. The user's master CV and
their never-say list are read server-side — never from the body.

Burst limit: **20 per minute** per user (same as `/api/tailor/letter-smart`).
Requires a valid session cookie.

### Request body

```json
{
  "text":           "Following up on my application...",
  "kind":           "follow_up",
  "recipient":      "hiring@example.com",
  "application_id": "uuid-of-tracker-row",
  "recent_texts":   ["Text of a recent cold email…", "Another one…"]
}
```

| Field | Required | Notes |
|---|---|---|
| `text` | Yes | The outreach message text to check. |
| `kind` | Yes | One of `follow_up`, `cold_email`, `dm`, `letter`. |
| `recipient` | No | The email address it will be sent to. Triggers ATS / no-reply check. |
| `application_id` | No | UUID of the tracker row. For `follow_up`: the row's status and `pending_outcome` are checked. |
| `recent_texts` | No | Array of recent outreach texts (max 50, each capped at 2 000 chars). Used for repeated-phrase detection. |

### Response

```json
{
  "ok":     false,
  "blocks": [
    { "code": "closed_row",         "phrase": "rejected",         "fix": "This application is closed or waiting for your confirmation — do not send a follow-up." },
    { "code": "retired_claim",      "phrase": "AssetGuard+",      "fix": "Remove \"AssetGuard+\" — it is on your never-say list." },
    { "code": "automated_recipient","phrase": "noreply@ats.com",  "fix": "This address belongs to an automated system. Find a named contact to email instead." },
    { "code": "availability_claim", "phrase": "I am available…",  "fix": "Remove availability claims from outreach text — state them on the application form instead." }
  ],
  "warns": [
    { "code": "unsupported_number", "phrase": "150",              "fix": "Check \"150\" is in your main CV before sending — it was not found there." },
    { "code": "repeated_phrase",    "phrase": "i am particularly excited…", "fix": "Rewrite this — used 3 times in recent outreach, recruiters notice repeated lines." },
    { "code": "untraced_claim",     "phrase": "I built a fraud-detection prototype…", "fix": "Check this claim is in your main CV — the words do not match any line there." },
    { "code": "retired_phrasing",   "phrase": "passionate about", "fix": "Replace \"passionate about\" with \"interested in\"." }
  ]
}
```

`ok` is `false` when any `blocks` are present. Warnings do not set `ok` to false.

**Block codes** (must fix before sending):
- `closed_row` — the application is closed or has a pending rejection; do not send a follow-up.
- `retired_claim` — a phrase on the user's never-say list appears in the text.
- `automated_recipient` — the recipient is a known ATS relay or no-reply address.
- `availability_claim` — the text states availability/notice-period details (use the application form instead).

**Warn codes** (review before sending):
- `unsupported_number` — a figure in the text was not found in the master CV.
- `repeated_phrase` — an 8+ word phrase appears in 3 or more of the supplied `recent_texts`.
- `untraced_claim` — a first-person experience sentence does not match any line in the master CV.
- `retired_phrasing` — a phrase on the never-say list was replaced with an alternative (the fix names it).

### Error responses

| Status | `errorType` | Meaning |
|---|---|---|
| 400 | (none) | `text` or `kind` missing or invalid. |
| 400 | `needs_cv` | The user has no main CV saved yet. |
| 429 | `burst_limit` | More than 20 calls in 60 seconds. |
| 401 | — | Not signed in. |

### Example call (browser console)

```js
const r = await fetch("/api/check/outreach", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: "Following up on my application. I built a fraud-detection prototype with 150 automated tests.",
    kind: "follow_up",
    application_id: "PASTE-YOUR-ROW-UUID-HERE",
    recipient: "hiring@example.com",
  }),
});
console.log(await r.json());
```
