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
