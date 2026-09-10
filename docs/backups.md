# Backups

What protects your data, how to get it back, and how to get it out.

Written for the owner, not for the machine. The design rationale lives in
`packages/core/src/worker/backup.ts`; this is the operating manual.

**Last verified:** 2026-08-29, against production, after the 4,421-row import.

## Read this when you cannot reach the repo

There is a published copy of this manual, reachable from any device with a
browser and no checkout, no laptop and no wrangler:

**https://claude.ai/code/artifact/cd23be9a-5d58-4ae8-a732-4a927dc870dc**

It is private to the owner's Claude account. It carries the triage table, the
restore steps with copy buttons, and the dashboard click paths.

The reason it exists is the one failure this file cannot cover: **a recovery
manual that lives only inside the repo is unreachable when the thing you have
lost is the machine holding the repo.** That is not a hypothetical for a system
whose whole point is surviving loss.

> **This file stays the source of truth; the page is a snapshot.**
> If you change anything below, republish the page from the same URL or the two
> will drift, and a stale recovery manual is worse than none. Ask Claude to
> "republish the recovery runbook" and give it that link -- publishing without
> the URL creates a second page instead of updating this one.

---

## The short version

| | |
|---|---|
| What runs | A Cron Trigger on the `fleet-portal` Worker |
| When | 02:00 Asia/Kuala_Lumpur, nightly (`0 18 * * *` UTC) |
| What it copies | **The whole database** — both portals, every table |
| Where it goes | R2 bucket `portals-backup`, key `fleet/YYYY-MM-DD.json` |
| How long it keeps | 90 days, then the old object is deleted |
| Size today | ~2.5 MB per night (was 47 KB before the ledger import) |

One database means one backup. Odometry's maintenance history and Coinbox's
ledger are in the same file, because they are in the same D1.

---

## Where everything lives, and how to reach it

The commands below all use `wrangler`, Cloudflare's command-line tool. It is
already installed with the project and already logged in as
`hazriq.fitri95@gmail.com`, so `npx wrangler ...` works from the repo root with
no setup. If it ever says you are logged out, `npx wrangler login` opens a
browser and fixes it.

**Everything must be run from the repo root** (`C:\Users\Hazriq Fitri\github\portals`).
The `-c wrangler.jsonc` in some commands points at the root config, which is
the one that knows about the database.

| Thing | Name | Where |
|---|---|---|
| Account ID | `d635376dc2be247b10234d81a23a15f5` | appears in every dashboard URL |
| The database | `fleet` | D1 |
| The backup bucket | `portals-backup` | R2 |
| The documents bucket | `portals-docs` | R2 -- receipts, NOT backed up, see below |
| The Worker that runs the backup | `fleet-portal` | Workers & Pages |
| The backup files | `fleet/YYYY-MM-DD.json` | inside the bucket |

### Clicking to it in the dashboard

You do not need the dashboard for any recovery step -- the commands are
enough -- but it is the easier way to confirm a file simply *exists*.

- **The backup files:** dash.cloudflare.com -> **R2 Object Storage** in the left
  sidebar -> **portals-backup** -> open the `fleet/` folder. You will see one
  object per night, named by date. Clicking one downloads it.
  Direct: `https://dash.cloudflare.com/d635376dc2be247b10234d81a23a15f5/r2/default/buckets/portals-backup`
- **Did the job run, and did it fail:** dash.cloudflare.com -> **Workers & Pages**
  -> **fleet-portal** -> **Logs**. Successful runs log one line; failures leave
  a stack trace, because `observability` is enabled on the Worker.
  Direct: `https://dash.cloudflare.com/d635376dc2be247b10234d81a23a15f5/workers/services/view/fleet-portal`
- **The database itself:** dash.cloudflare.com -> **Storage & Databases** ->
  **D1** -> **fleet**. This is also where Time Travel lives if you would rather
  click than type.

### Orienting from the command line instead

```bash
npx wrangler whoami                         # which account am I logged into
npx wrangler r2 bucket list                 # what buckets exist
npx wrangler d1 list                        # what databases exist
```

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

**The key carries the UTC date, and the job runs at 02:00 Malaysian time.**
02:00 MYT is 18:00 UTC on the *previous* day, so the backup taken at 2am on the
29th is stored as `fleet/2026-08-28.json`. Looking for today's date will always
report a missing object and always be a false alarm. **Subtract a day.**

```bash
# is last night's there? (2am today MYT == yesterday's UTC date)
npx wrangler r2 object get portals-backup/fleet/2026-08-28.json --remote --file=b.json
```

If it is missing, the logs are kept — `observability` is enabled on the Worker,
so a failed run leaves evidence rather than vanishing. Cloudflare dashboard →
Workers & Pages → fleet-portal → Logs.

The job logs one line on success:

```
Backup fleet/2026-08-28.json: 9123 rows across 19 tables, 2525555 bytes
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

**The import has landed, so this is no longer hypothetical.** Coinbox holds
4,421 rows and is the real ledger now; the Sheet is the historical copy. Going
back means exporting the CSV below and pasting it into a Sheet.

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

## Receipts are not in the backup

Since 2026-09-10 a service record in Odometry can carry scanned receipts. The
**rows** describing them are in the nightly export like everything else -- the
filename, size, type and the key that finds the file. **The files themselves
are not.** They live in a separate R2 bucket, `portals-docs`, which nothing
backs up and which D1 Time Travel does not reach.

So the two safety nets above protect the database, and receipts sit outside
both. What that means in practice:

| If this happens | The receipts |
|---|---|
| You delete a service record by accident | Gone. Deleting a record deletes its files deliberately, and Time Travel restoring the row will not bring the file back |
| You restore the database to an earlier day | Rows may point at files that were since deleted; the app shows those as "Attachment file is missing" rather than breaking |
| You lose the Cloudflare account | Gone, along with everything else -- this is the gap the whole "off-Cloudflare copies" item below is about |

This is a deliberate limit, not an oversight. Putting the bytes in D1 would
mean re-uploading every receipt inside a JSON file every night for ninety
nights, and the export encodes columns with `JSON.stringify`, which turns a
binary column into `{}` and breaks the restore silently.

**If receipts start mattering as much as the data**, the cheap fix is R2
object versioning plus a lifecycle rule on `portals-docs`, set from the
dashboard -- no code. The thorough fix is including the bucket in the nightly
job, which changes the export from one JSON file into something that needs its
own format. Neither is built.

Listing what is in there, if you ever need to:

```bash
npx wrangler r2 object list portals-docs --remote
```

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
- **Again on 2026-08-29, at real volume.** The 255-row check above predates the
  ledger import and proved nothing about 4,421 rows. Repeated end to end: the
  scheduled 18:00 UTC run wrote 9,123 rows across 19 tables (2.5 MB), that
  object was restored into local, and it brought back 5 rows local did not have
  — so the restore demonstrably wrote rather than matching by luck. Foreign
  keys clean. `export-csv.mjs` was run on the same file: 19 CSVs, and a
  `24550`-sen row came out as `173.80` in `amount_rm`.

A backup nobody has restored from is a belief, not a backup.
