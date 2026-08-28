# Backups

What protects your data, how to get it back, and how to get it out.

Written for the owner, not for the machine. The design rationale lives in
`packages/core/src/worker/backup.ts`; this is the operating manual.

**Last verified:** 2026-08-28, against production.

---

## The short version

| | |
|---|---|
| What runs | A Cron Trigger on the `fleet-portal` Worker |
| When | 02:00 Asia/Kuala_Lumpur, nightly (`0 18 * * *` UTC) |
| What it copies | **The whole database** — both portals, every table |
| Where it goes | R2 bucket `portals-backup`, key `fleet/YYYY-MM-DD.json` |
| How long it keeps | 90 days, then the old object is deleted |
| Size today | ~47 KB per night |

One database means one backup. Odometry's maintenance history and Coinbox's
ledger are in the same file, because they are in the same D1.

---

## You have two independent safety nets

They fail differently, which is the point of having both.

### 1. D1 Time Travel — 30 days, automatic, no code

Cloudflare keeps a rolling 30-day history of the database and can restore it to
any moment in that window. Nothing was built for this; it is on by default.

**This was measured, not assumed** (2026-08-28): a timestamp 7 days back is
accepted, 31 days back is rejected.

```bash
# where can I go back to?
npx wrangler d1 time-travel info fleet -c wrangler.jsonc

# what did it look like at a moment in time?
npx wrangler d1 time-travel info fleet -c wrangler.jsonc --timestamp=2026-08-21T00:00:00Z

# put it back (DESTRUCTIVE, production)
npx wrangler d1 time-travel restore fleet -c wrangler.jsonc --bookmark=<bookmark>
```

**Use this for:** "I deleted something this morning", "that migration was
wrong", "yesterday was better." It is faster and more precise than the nightly
backup, and it should be your first reach.

### 2. The nightly R2 export — 90 days, a file you own

**Use this for the three things Time Travel cannot do:**

1. **Go back further than 30 days.** A mistake noticed in month two.
2. **Survive losing the Cloudflare account.** Time Travel lives inside the
   thing it is protecting. If the account goes, so does it.
3. **Leave.** A Time Travel bookmark is not a file. You cannot open it, read
   it, diff it, mail it to yourself, or load it into Postgres. The JSON export
   is an actual file that exists independently of Cloudflare.

Retention is 90 days precisely because Time Travel already covers 30. A shorter
window would have added nothing.

---

## Checking it ran

```bash
# is last night's there?
npx wrangler r2 object get portals-backup/fleet/2026-08-29.json --remote --file=b.json
```

If it is missing, the logs are kept — `observability` is enabled on the Worker,
so a failed run leaves evidence rather than vanishing. Cloudflare dashboard →
Workers & Pages → fleet-portal → Logs.

The job logs one line on success:

```
Backup fleet/2026-08-29.json: 255 rows across 15 tables, 47481 bytes
```

**Nobody is alerted if it fails.** That is the known weakness. Real alerting
needs an email provider, which is not set up. Until then, checking after any
week that matters is the honest answer.

**A newly deployed cron takes ~15 minutes to start firing.** If you have just
redeployed and nothing has run, that is usually why, not a fault.

---

## Getting it back

### Into your local database — safe, and the one to practise on

```bash
npx wrangler r2 object get portals-backup/fleet/2026-08-28.json --remote --file=b.json
node scripts/restore.mjs b.json
```

This wipes the local database and replaces it with the file's contents. Local
is disposable, so this costs nothing and is worth doing occasionally to confirm
the backups are real.

It prints row counts before and after, and refuses to claim success if the
foreign key check finds a broken reference.

### Into production — destructive, deliberate

```bash
node scripts/restore.mjs b.json --remote --i-mean-it
```

The `--i-mean-it` is required because this **deletes every row in production**
and replaces it. It is the only operation here whose entire purpose is
destruction, so it does not happen by accident.

Prefer Time Travel if the damage is under 30 days old. It is less blunt.

### The safety interlock

A restore **refuses to run if the database is at a different migration state
than the backup was taken at.** Loading rows into a schema they did not come
from loses data silently — a dropped column vanishes, a renamed one arrives
empty, and nothing errors. So it stops rather than guessing.

If you see `Migration mismatch`, bring the target to the backup's migration
state first (`npm run db:apply:local`). Do not reach for
`--skip-migration-check` unless you have checked the schemas by hand.

---

## Getting the data OUT — as CSV, Excel, or a Sheet

The backup is JSON. JSON is the right format for restoring exactly, and the
wrong format for opening on a phone. So there is a converter:

```bash
npx wrangler r2 object get portals-backup/fleet/2026-08-28.json --remote --file=b.json
node scripts/export-csv.mjs b.json --out csv/
```

That writes one CSV per table into `csv/`. Double-click any of them in Excel,
or File → Import in Google Sheets.

Three things it does that a naive dump would not:

- **Money is converted to ringgit and the header says so.** It is stored as an
  integer count of sen, so `24550` means RM 245.50 — exporting that raw would
  read as twenty-four thousand ringgit. Columns come out as `cost_rm`,
  `purchase_price_rm`, `amount_rm`. Pass `--raw-money` if you want the integers.
- **It writes a UTF-8 BOM**, because Excel guesses the encoding without one and
  mangles anything non-ASCII. `--no-bom` if some other tool objects.
- **It defuses formula injection.** Excel and Sheets execute a cell starting
  with `=`, `+`, `-` or `@`. A workshop named `=SUM` in your own data would
  otherwise run when you opened the file.

Useful flags: `--table vehicles` for just one, `--out somewhere/` to choose the
directory.

The JSON is also plain text with an obvious shape, if you would rather read it
directly:

```jsonc
{
  "version": 1,
  "taken_at": "2026-08-28T03:16:34.538Z",
  "migrations": ["0001_init.sql", "...", "0010_ledgers.sql"],
  "tables": {
    "vehicles": {
      "columns": ["id", "garage_id", "nickname", "..."],
      "rows": [{ "id": "...", "nickname": "Waja" }]
    }
  },
  "row_counts": { "vehicles": 3 }
}
```

---

## Can I go back to Google Sheets?

**Today, trivially — because nothing has moved yet.** Coinbox's ledger is
empty; the Sheet is still the real one. "Reverting" means continuing to use it.

**After the import: export the CSV and paste it into a Sheet.** That path is
built and is the answer to this question. What is still missing is only the
*automatic* version — something that keeps a Sheet current without you running
a command:

- ~~A CSV export.~~ **Built 2026-08-28** — `scripts/export-csv.mjs`, above.
  This is the practical answer to "let me look at my own data", and it landed
  before the import deliberately, so the readable path exists from the first
  row rather than after.
- **The Sheets mirror** (`docs/coinbox-spec.md` §7, decision 6). A nightly
  overwrite of a Google Sheet, so a readable copy always exists without anyone
  running a command. Deferred until the ledger has rows worth mirroring, and it
  costs more than it looks: a Google service account, JWT signing inside the
  Worker, and a secret to rotate.

**Neither is blocking anything, and both are worth deciding before the import
rather than after.** Being able to read your own ledger without the app is a
reasonable thing to want from a system that replaced a spreadsheet.

---

## What is not built

- **Alerting on failure.** Logs are kept; nobody is told. Needs an email
  provider.
- **XLSX specifically.** CSV is built (see above) and opens in Excel; a real
  `.xlsx` with one sheet per table is not, and has not been needed.
- **The Sheets mirror.** See above.
- **Off-Cloudflare copies.** Every backup is in R2, which is in the same
  account as the database. That covers deletion and corruption, not account
  loss. Downloading one object a month somewhere else closes it, and takes a
  minute.

## What is verified

Not claimed — run.

- The round trip runs on every `npm test` (`apps/odometry/tests/backup.test.ts`):
  seed, dump, wipe, restore, then check row counts per table, a row field by
  field, and an empty foreign key check. It was made to fail on purpose first.
- **Against production, 2026-08-28:** the cron wrote
  `fleet/2026-08-28.json` (47 KB, 15 tables), that object was pulled from R2
  and restored into the local database, and local came back holding
  production's 3 vehicles and 96 maintenance intervals — 255 rows, foreign keys
  clean.

A backup nobody has restored from is a belief, not a backup.
