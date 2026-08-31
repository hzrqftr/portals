# Coinbox — Technical Specification

**Version:** 0.2
**Status:** Live. 4,421 transactions in production; recurring entries built 2026-08-29; Home dashboard built and deployed 2026-08-31 (§10)
**Target:** Replace a Google Form + Sheet expense log

---

## 1. Overview

Coinbox is a personal **expense ledger**. It replaces a Google Form feeding a
Google Sheet, chosen originally because it was cheap to build, not because it
was the right long-term answer.

### 1.1 What the Form cannot do, and this must

- **Conditional field visibility.** Selecting a fuel or vehicle category should
  reveal vehicle-specific fields; most categories should not.
- **Editing past entries.** Google Forms cannot amend a submission.
- **Real validation**, shared between client and server via Zod.
- **Vehicle attribution as a first-class field**, not a string buried in a
  free-text description.

### 1.2 Non-goals

This is an expense ledger, not a personal finance app. Explicitly out of scope:
account balances (the banks and wallets have no API, so reconciliation is not
feasible), budgets, net worth tracking, loan amortisation, multi-currency, and
recurring-transaction **detection** — inferring from history that a set of past
entries forms a pattern. Parity with the Form, plus §1.1.

**Recurring *entry* is in scope and is built — see §9.** The distinction is the
whole difference: the owner declares "Insurance, RM 230, the 15th of every
month" and a nightly job posts it. Nothing inspects the ledger to guess. Read
the non-goal above as "Coinbox will not tell you that you have a subscription",
not "Coinbox cannot repeat an entry".

### 1.3 Relationship to Odometry

Two portals, one Cloudflare account, **one D1 database**, one repo.

**Ownership rule:** money rows are owned by Coinbox, fleet structure is owned
by Odometry. No duplicated rows and no syncing between them. The link is a
nullable `vehicle_id` on transactions and, later, a nullable `transaction_id`
on service records. Which UI you type into is a front-end question, not a data
question.

The repo is shared because the *database* is shared. See the root `CLAUDE.md`,
"One database, one repo", for why that is not a style preference.

---

## 2. Architecture

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers, static assets + API in one Worker |
| Frontend | React 18, TypeScript, Vite, Tailwind, TanStack Query |
| API | Hono under `/api/*` |
| Database | Cloudflare D1 (SQLite) via Drizzle, shared with Odometry |
| Auth | Cloudflare Access, Google IdP, allowlist |
| Validation | Zod, shared between client and server |

### 2.1 Two Workers, not one

Coinbox is a separate Worker from Odometry. The deciding constraint is that
neither Worker touches `env.ASSETS`: `assets.run_worker_first: ["/api/*"]`
means the platform serves every non-API path before the Worker runs at all.
Two SPAs therefore cannot share one Worker without an asset-routing fallback
that exists in neither codebase.

Separate Workers also mean a Coinbox deploy cannot take the fleet portal down.

### 2.2 Access

Coinbox has its **own Access application** with a **narrower allowlist than
Odometry's** — the owner only. Someone added to Odometry for fleet access
cannot load the Coinbox login page.

This is defence in depth *behind* the ownership key, not instead of it. The
ledger predicate (§5) is what is actually relied upon; the allowlist is a
second door, and neither is trusted to be the only one.

---

## 3. Tenancy model

**The ownership axis is a LEDGER, and it is deliberately not a garage.**

Odometry indirects ownership through a `garage`, which exists so a garage can
be shared between people in one household. Finances are not garage-scoped: if
someone is added to a garage so they can see service schedules, they must not
thereby see a salary.

There is **no `ledger_members` table**, so no membership can be granted at all.
Sharing is unrepresentable, not merely absent.

### 3.1 Why a `ledgers` table rather than `owner_user_id` on transactions

The costs are asymmetric. Changing the ownership column on `transactions`
later means the SQLite 12-step table rebuild (see migrations `0007`, `0008`)
against real financial history, plus every repository predicate and the scope
resolution. Adding `ledger_members` later is by contrast purely additive — a
new table, nothing rebuilt, no predicate changed.

One small table now buys that option. This is the lesson Odometry already
learned with `garages`, minus the membership surface that would give the
isolation suite a new leak path to cover.

### 3.2 First-login bootstrap

`users` is shared with Odometry, so someone who has used the fleet portal
already has a row. `resolveLedgerScope()` must therefore handle "user exists,
ledger does not", not only a wholly new person.

The ledger insert reads its owner back out of `users` rather than binding a
generated id, so two racing first requests cannot produce a foreign key
violation on a brand new account.

---

## 4. Data model

> **§4.2 onward was written as a proposal and is now BUILT** — migrations
> `0010` (ledgers), `0011` (transactions, categories, import tables) and `0012`
> (recurring). Two things changed on the way in, and the built version wins
> where this text disagrees:
>
> - `amount_sen` is `CHECK (amount_sen >= 0)`, not `> 0`. Eight RM 0.00 water
>   bills are real data, recorded so a monthly average has a value for every
>   month.
> - `vehicle_id` carries **no** foreign key, so a garage deletion cannot
>   cascade into financial history. It is validated on write instead.

### 4.1 Type conventions

Identical to Odometry (root `CLAUDE.md` invariant 1):

- money → `INTEGER`, minor units (sen). Never `REAL`.
- calendar dates → `TEXT` `YYYY-MM-DD`, no time component.
- timestamps → `TEXT` ISO 8601 UTC.
- booleans → `INTEGER` 0/1.
- enums → `TEXT` + `CHECK`.

### 4.2 `transactions` (proposed)

```sql
CREATE TABLE transactions (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  occurred_on     TEXT NOT NULL,                 -- YYYY-MM-DD, user's calendar
  item            TEXT NOT NULL,
  description     TEXT,
  category_id     TEXT NOT NULL REFERENCES categories(id),
  vehicle_id      TEXT REFERENCES vehicles(id),  -- nullable; the Odometry link
  amount_sen      INTEGER NOT NULL CHECK (amount_sen > 0),
  direction       TEXT NOT NULL CHECK (direction IN ('in','out')),
  signed_sen      INTEGER GENERATED ALWAYS AS
                    (CASE direction WHEN 'out' THEN -amount_sen ELSE amount_sen END) VIRTUAL,
  source_type_raw TEXT,                          -- import only; dropped after reconciliation
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

**Magnitude plus direction, sign derived.** The positive-magnitude `CHECK`
makes a sign error impossible at write time, which matters because a missed
negation on one insert path is silent rather than visible. The generated
column keeps aggregation to `SUM(signed_sen)` with no `CASE` repeated across
queries and no chance of two reports disagreeing. `VIRTUAL` costs no storage.

**`in`/`out`, not debit/credit.** Debit and credit are genuinely ambiguous
here: by ledger convention a debit increases an asset account, but a bank
statement is written from the bank's perspective and shows money arriving as a
credit. Same word, opposite meanings, both correct. They only earn their keep
in double-entry, where every transaction has two sides that must balance —
this is a single pooled account and a flat log, so there is no second side and
nothing to balance. And not `income`/`expense`: categories are deliberately
not bound to a direction, so naming the direction after a category-like
concept would quietly re-couple them.

### 4.3 `categories` (proposed)

Flat, roughly 20, **not bound to direction** — any category may appear as
either. `ledger_id` nullable, where NULL means a global seed row, following
the `part_types` precedent in `0001`, including its partial-unique idiom:

```sql
CREATE UNIQUE INDEX uq_category_code ON categories(COALESCE(ledger_id, ''), code);
```

`UNIQUE` does not constrain NULLs in SQLite, which is exactly the trap a
nullable "applies to everything" column makes common.

### 4.4 Indexes (proposed)

```sql
CREATE INDEX idx_txn_ledger_date     ON transactions(ledger_id, occurred_on DESC);
CREATE INDEX idx_txn_ledger_category ON transactions(ledger_id, category_id, occurred_on);
CREATE INDEX idx_txn_vehicle         ON transactions(vehicle_id) WHERE vehicle_id IS NOT NULL;
```

### 4.5 Views

Aggregation happens in SQL, never JS loops (invariant 4). Two rules carry over
from `0002_views.sql`:

- **No view may call `date('now')` or `CURRENT_DATE`.** The Worker runs in UTC
  and the owner is at UTC+8, so "today" is computed from `users.timezone` and
  passed as a bound parameter. Views expose parameter-free facts.
- The aggregation idiom is `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`
  filtered `WHERE rn = 1`, not `GROUP BY` with a correlated max.

---

## 5. Tenant isolation

Identical in structure to Odometry's spec §5, with `ledger_id` in place of
`garage_id`. Repositories extend `LedgerScopedRepo`, whose `where()` folds in
the tenant predicate on every call and cannot be bypassed.

### 5.1 The one place the two axes meet

A transaction may reference a vehicle. The transaction is ledger-scoped; the
vehicle is garage-scoped. So `assertUsableVehicle()` cannot use the ledger
predicate — it has to ask Odometry's question: *is this vehicle in a garage
the caller is a member of?*

This is the only write path where a cross-portal leak could hide. It is
already written and covered even though nothing calls it yet.

### 5.2 Enforcement

Three mechanisms, per Odometry's §5.2 "implement at least two of":

1. `scripts/check-db-imports.mjs` — `env.DB` and the Drizzle client may not
   appear outside `data/`, enforced across the whole workspace from one place.
2. `LedgerScopedRepo` — the predicate cannot be omitted.
3. `apps/coinbox/tests/isolation.test.ts` — including the **garage co-member**
   case, verified by deliberately injecting a missing predicate and confirming
   four tests fail.

---

## 6. Migration from the Sheet

**Measured against the real export on 2026-08-28** (`ledger.csv`, 649 rows,
2026-01-01 to 2026-08-28). Everything below is from that file, not estimated.

Columns: `Timestamp, Item, Amount, Category, Description, Type`.

- `Timestamp` is a **calendar date**, format `DD-MMM-YYYY` (`01-Jan-2026`). No
  time component, so it maps to `occurred_on` directly.
- `Amount` is a **string with a currency prefix**, `RM197.90`. Strip and
  convert to sen. All 649 parsed; no thousands separators appeared, but the
  parser should accept them.
- `Type` is `Debit` (money in, 42 rows) or `Credit` (money out, 607 rows).
  `Debit → in`, `Credit → out`. Keep the original string in `source_type_raw`,
  and drop the column once totals are verified.
- **16 categories, flat**, confirming §7 decision 1. Import the labels
  verbatim, including `Food/ Drinks` with its odd internal space — normalising
  it silently makes the source and the import disagree for no gain.

### Reconciliation targets

| | Sheet | Expected after import |
|---|---|---|
| Rows | 649 | 648 |
| Money in | RM 63,884.68 | RM 63,884.68 |
| Money out | RM 66,285.20 | RM 66,280.21 |
| Net | −RM 2,400.52 | −RM 2,395.53 |

The RM 4.99 difference is the deliberately dropped duplicate below. **An import
that reconciles exactly to the Sheet is wrong**, which is exactly the kind of
thing to write down before it is rediscovered as a bug.

### Categories are not bound to direction — now demonstrated, not argued

Four categories appear as **both** directions in the real data: `Household`
(2 in / 68 out), `Miscellaneous` (12/3), `Family` (1/16), `Savings` (2/8). Any
schema that binds a category to a direction cannot represent this file.

### Idempotent re-runs

An `import_batches` table plus a `UNIQUE` hash of the source row.

**The hash MUST include the source line number.** The file contains two rows
identical in every field — `19-May-2026, Motorcycle fuel, RM4.99, Setel`, lines
375 and 377. A hash over content alone makes them collide, so one is silently
dropped and the total is quietly RM 4.99 light with no error anywhere. Line
number keeps a genuine repeat distinct from a re-run.

### Fuel and vehicle attribution — the triage screen is NOT needed

The earlier estimate of "roughly 80 ambiguous car rows needing a manual triage
screen" was wrong by more than five times. Actual counts:

| | Rows |
|---|---|
| `Motorcycle fuel` — unambiguous, → RS150R | 95 |
| `Car fuel` naming a car in `Description` | 1 |
| **`Car fuel` genuinely ambiguous** | **14** |

Fourteen rows is a conversation, not a UI. **Do not build the triage screen.**

`Description` resolves more than expected: `Engine oil + filter / City`,
`Insurance & roadtax renewal / City - To Kdik`, `Engine oil & filter / Waja`.
Overall 117 rows resolve to RS150R, 5 to City, 3 to Waja.

### Status: BUILT and run against local, 2026-08-28

`scripts/import-sheet.mjs`. Reconciled exactly on the first real run — 648
rows, RM 63,884.68 in, RM 66,280.21 out, net −RM 2,395.53, all four figures
matching the parse against the database. The script **aborts rather than
reporting success** if any of them disagree.

Idempotency was verified rather than assumed: a second run reported 648 already
imported, 0 to insert, and identical totals.

Verified in the data, not just in the counters: one surviving row for the
dropped duplicate; 3 rows carrying `source_category_raw = 'Transportation'`;
138 rows attributed to a vehicle (116 RS150R, 19 City, 3 Waja); and the
direction mapping exact at 42 `Debit → in` and 606 `Credit → out`.

**Not yet run against production.** The remote import needs `--remote
--i-mean-it`.

### Import rules settled with the owner, 2026-08-28

1. **The 14 ambiguous `Car fuel` rows → City.** An owner decision, not evidence
   from the file — the one row that names a car says Waja. Record it as a
   decision so it is never mistaken for something the Sheet recorded.
2. **Toll fare, parking and similar (56 rows) → no vehicle.** A toll is a trip
   cost, not a vehicle cost, and attributing it would dilute cost-per-km.
3. **Three miscategorised rows are corrected on the way in:**
   `Ceiling light & screwdriver` (11-Apr) → Household; `Dinner` (07-Aug) and
   `Lunch` (17-Aug) → Food/ Drinks; all three currently `Transportation`.
   **Keep the original in `source_category_raw`**, the same way `Type` is kept,
   so the correction stays auditable and the source remains recoverable.
4. **The duplicate pair is a double Form submission — import one.** Hence 648
   rows, and the reconciliation table above.

---

## 7. Open decisions

Genuinely undecided. Whoever implements next should ask rather than pick.

1. ~~**Category structure.**~~ **SETTLED 2026-08-28: flat, ~20, unbound to
   direction.** Matches the Sheet, so the import is a direct mapping with
   nothing to invent. Grouping stays easy to add later and hard to remove, so
   it waits for a reason. Do not add a `direction` column to `categories`.
2. ~~**How much of the Odometry link to build in phase one.**~~
   **SETTLED 2026-08-28: the nullable `vehicle_id` only.** A transaction may
   name a vehicle, which is enough for fuel and service attribution and for
   cost-per-km later. The reverse link (`transaction_id` on service records)
   and any shared UI are deferred -- they couple the two portals' write paths,
   which is the expensive half and the one that can leak.
3. **The `user_settings` split.** That table mixes shared columns (`currency`,
   `date_format`, `distance_unit`) with Odometry-specific ones (`due_soon_*`,
   `fallback_km_per_day`, `stale_odometer_days`). Coinbox reads only the shared
   ones. Splitting it is deliberately deferred, and recorded here so it is not
   "discovered" later and refactored by accident.
4. **Cross-portal navigation.** Deferred. The clean mechanism is Access groups,
   but `ctx.access` is not populated in production (which is why the JWT
   assertion fallback exists) and the assertion payload carries no groups
   claim. `AppHeader` takes a `portals` prop that nothing passes, so switching
   it on later is passing an array rather than reworking chrome in two apps.
5. ~~**The wordmark.**~~ **CLOSED 2026-08-28: body type, indefinitely.**
   Odometry's Bukhari Script woff2 is subset to the eight letters of
   "Odometry" and licensed for personal use only, so it cannot be reused.
   Coinbox stays on body type. Nothing depends on this and it was cluttering
   the blocked list; reopen it only if the owner actively wants a face.
6. **Backups — RESOLVED for R2, 2026-08-28. Sheets mirror still open.**
   The nightly D1 → R2 export is built and runs from the fleet-portal Worker
   (one D1, one backup, covering both portals). Retention is 90 days, chosen
   because D1 Time Travel was measured at 30 and a shorter window would add
   nothing.

   The restore path is exercised rather than assumed, as this decision
   required: `apps/odometry/tests/backup.test.ts` runs the full round trip on
   every `npm test`, and it was run by hand against the local database — 208
   rows, 15 tables, foreign key check clean.

   **Still open: the Sheets mirror.** Deferred deliberately until the ledger
   has rows worth mirroring. It needs a Google service account, JWT signing
   inside the Worker, and a rotatable secret — a separate piece of work from
   the durability guarantee, which is now met. Its appeal is that a mirror is
   readable on a phone without the app, which the R2 JSON is not.

---

## 8. UX requirements

- **Never render a negative number.** Show magnitude with a colour and a
  prefix.
- The entry screen leads with two large direction buttons, defaulting to
  `out`, since that is the overwhelming majority of rows — a miscategorised
  inflow should be visually obvious rather than buried in a dropdown.
- Fast on mobile: that is where entry actually happens.

## 9. Recurring entries

Built 2026-08-29. Fixed monthly commitments — personal insurance at RM 230,
Astro, subscriptions — were the last routine reason to open the Google Sheet.
The owner declares a rule once and the ledger posts it.

**This is recurring *entry*, not the recurring-transaction *detection* §1.2
rules out.** Nothing here inspects history to infer a pattern.

### 9.1 Decisions, as settled with the owner

| Decision | Choice |
|---|---|
| On the due date | **Post automatically.** No confirmation step |
| Patterns | Monthly, every N months, yearly. **No weekly** |
| Day 31 in February | **Clamp to the last day**, back to the 31st in March |
| A rule added with a past start date | **Forward-only.** Never backfills |
| Pausing | A toggle, separate from the optional end date |
| Vehicle link | Yes, mirroring the transaction form |
| Deleting a transaction | **Built** — see 9.5 |
| Editing a rule | A `Sheet`, not a page per rule |

**The accepted risk, recorded because it was accepted rather than overlooked:**
auto-posting means the ledger can assert a payment that did not happen — a
cancelled subscription keeps posting until noticed. The owner was shown this and
chose it over a confirm step. The marker and filter in 9.4, and delete in 9.5,
are what make it recoverable rather than invisible.

### 9.2 Schema

`recurring_rules` holds the transaction template — the same magnitude-plus-
direction shape as `transactions`, `amount_sen >= 0` — plus the schedule as
`interval_months` and `day_of_month`, with the phase carried by `starts_on`.

**No `frequency` enum beside `interval_months`**, which would be the
`categories.direction` mistake again: a second column encoding a fact the first
already carries and free to disagree with it. **No `next_due_on` cursor**
either — it would cache what `recurring_postings` already knows, and a cache
that is wrong posts money on the wrong day. Both absences are asserted in
`tests/recurring-schema.test.ts`.

`recurring_postings(rule_id, occurred_on)` is the idempotency interlock; its
primary key is what makes the nightly run safe to repeat. `transaction_id` is
`ON DELETE SET NULL`, so deleting a posted entry leaves the claim behind and the
next run does not re-create it.

### 9.3 The clamp is unexpressible in SQL

`date('2026-01-31','+1 month')` is `2026-03-03` — SQLite normalises forward
rather than clamping. Measured, not assumed. So the arithmetic lives in
`src/shared/recurrence.ts`, no view is added, and no due date is computed in
SQL. Each occurrence is derived from `day_of_month` against its own month;
iterating from the previous occurrence drifts permanently after one February.

### 9.4 What the ledger shows

Auto-posted entries carry `transactions.is_recurring = 1`, rendered as a marker
in the Date cell and filterable from the ledger toolbar. The column exists
rather than being derived from `recurring_postings` because it **survives**:
deleting a rule cascades its claims away, and without it "was this auto-posted?"
would become unanswerable for entries already in the ledger.

It is immutable — absent from `transactionPatch`, which is `.strict()`.

### 9.5 Delete, and why it was reopened

`docs/status.md` recorded deleting a transaction as deliberately deferred,
wanting "more thought than an afternoon". Recurring entries are the reason it
was reopened: a rule that posts without confirmation will eventually post
something wrong, and editing that entry to RM 0.00 is not an undo — it leaves a
row asserting a payment that never happened, still counted in `v_txn_monthly`.

**Auto-post without delete is the unsafe combination**, so the two shipped
together. Hard delete, not a `deleted_at` flag: a soft delete would need
`WHERE deleted_at IS NULL` in every read, view and future report, and one
omission silently returns a deleted row to a total. Recovery is the nightly R2
export (90 days) plus D1 Time Travel (30).

### 9.6 The cron

`0 17 * * *` on the **coinbox** Worker — 01:00 Asia/Kuala_Lumpur, deliberately
one hour before fleet-portal's 18:00 UTC backup so the night's entries are in
that night's dump.

Correctness does not depend on the hour: the runner posts only occurrences
dated on or before `todayIn(owner.timezone)`, computed **per ledger**. It can
therefore be late by at most one run and can never be early, in any timezone.

It is the only unscoped writer in the portal. It runs one unscoped statement —
a roster of which ledgers have work and in whose timezone — then builds a real
`Scope` per ledger and goes back through the ordinary `LedgerScopedRepo`, so
every insert carries the tenant predicate. `BaseScopedRepo` was not widened.

### 9.7 Navigation

Three top-level sections: Home at `/` (the dashboard — §10), Ledger at
`/ledger`, Recurring at `/recurring`. `AppHeader` gained an optional `nav` prop
defaulting to `[]`, so Odometry is untouched.

---

## 10. The dashboard

Built 2026-08-31. Home held the root empty from the start precisely so this
could land without moving the ledger out from under a bookmark.

**What it replaces:** the half of the Google Sheet that was never the log — a
twelve-row Surplus/Deficit table plus a Total. Both are now one chart.

### 10.1 One payload

`GET /api/dashboard[?month=YYYY-MM]`, served by `DashboardRepo`. Composing it
client-side from five requests is five round trips to paint one screen on
mobile data, which is the same argument Odometry's spec §7 makes.

`today` is computed once, in the route, from `users.timezone`. Nothing below
it decides what day it is, and no view underneath may call `date('now')`.

### 10.2 What is on it, and why each earns a place

The test a figure has to pass: **would a 20% change in it alter what you do
this week?** Everything else is a report, not a dashboard.

| Element | Answers |
|---|---|
| Net for the month, with month-over-month | "Am I ahead or behind, and against what?" |
| Out, against the trailing three-month mean | "Is this month unusual, or does it just feel it?" |
| Committed in the next 30 days | "How much of what is left is already spoken for?" |
| Days since the last **typed** entry | "Can I believe the three figures above?" |
| The year, as diverging columns + a running total | The shape a table of twelve numbers cannot show |
| What moved, vs each category's own normal | "Why was this month unlike the others?" |
| Cost per km, per vehicle | The one figure neither portal can produce alone |

### 10.3 Deliberately absent

- **Savings rate.** `Savings` appears in this ledger in BOTH directions (2 in
  / 8 out in the real export), so money moving into savings is
  indistinguishable from income. The rate would be confidently wrong. It needs
  a transfer concept first, which is out of scope.
- **Budget vs actual.** There is no budget data, and inventing one to fill a
  gauge produces a number nobody believes by the second month.
- **Net worth or balances.** §1.2 non-goal; a flat log has no balances.
- **Year-over-year.** The data starts 2026-01-01.
- **A pie of category share.** Share barely moves month to month, and a pie
  cannot be read for change — which is the only question worth asking of it.

### 10.4 Months that have not happened are empty, not zero

The Sheet fills September to December with RM 0.00, which renders as four
break-even months. The chart gives them no column and dims their labels.

A later addition worth considering, and the only honest thing to put in that
space: ghost columns showing what the recurring rules already commit for those
months. That is a projection from declared rules, not a guess.
