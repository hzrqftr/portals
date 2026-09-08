# CLAUDE.md — Coinbox

App instructions. **Read the workspace `CLAUDE.md` at the repo root first** —
it holds the stack-level invariants, the commands, and why the two portals
share one repo. This file holds only what is specific to the ledger.

## Project

A personal **expense ledger**, replacing a Google Form feeding a Google Sheet.
One Cloudflare Worker (`coinbox`) serving a React SPA and a JSON API.

Design lives in `docs/coinbox-spec.md`. **The ledger schema is built as of
2026-08-28** — `ledgers` (`0010`), then `transactions`, `categories` and the
import tables (`0011`). §7's open decisions are settled and recorded there;
§6 was rewritten from the owner's real 649-row export rather than from memory.

The importer is built too (`scripts/import-sheet.mjs`) and has been run
against the local database: 648 rows reconciling exactly. It is idempotent —
re-running inserts nothing — and it aborts rather than reporting success if the
totals disagree.

**The portal is live.** 4,421 transactions in production, the full ledger UI,
recurring entries with a nightly cron (2026-08-29), and the Home dashboard
(2026-08-31). Every read endpoint is in `readEndpoints` in
`tests/isolation.test.ts` — the moment another one lands, it goes there too.
No exceptions.

## Scope line

This is an expense ledger, **not a personal finance app**. Out of scope: account
balances (the banks have no API, so reconciliation is not feasible), budgets,
net worth, loan amortisation, multi-currency, recurring-transaction **detection**.
Parity with the Google Form, plus the things the Form cannot do: conditional
fields, editing past entries, real validation, and vehicle attribution as a
first-class field.

**Recurring *entry* is in scope and was built 2026-08-29. It is not the same
thing as detection.** The owner declares a rule and a nightly cron posts it;
nothing infers a pattern from history. If you are reading the non-goal above and
about to conclude this feature violates the spec, that is the distinction it is
drawing. See `docs/coinbox-spec.md` §9.

## Ownership axis: the ledger

Coinbox scopes on `ledger_id`, resolved in `src/worker/scope.ts`. Repositories
extend `LedgerScopedRepo` in `src/worker/data/base.ts`.

**There is no `ledger_members` table, and adding one is a product decision, not
a refactor.** Sharing is currently unrepresentable, which is the point: adding
someone to your *garage* in Odometry so they can see service schedules must
never expose your salary.

**Never put a `garageId` on the `Scope` object.** That is precisely how this
leak would happen — someone adds it "just for the vehicle picker", and a later
query filters by it. `apps/coinbox/tests/isolation.test.ts` asserts it is
absent.

`users` and `user_settings` are shared with Odometry. A person who has used the
fleet portal already has a row, so bootstrap handles "user exists, ledger does
not". Coinbox reads only the shared columns of `user_settings` (`currency`,
`date_format`) and must not grow a dependency on the fleet-specific ones.

### The one place the two axes meet

A transaction may reference a vehicle. The transaction is ledger-scoped; the
vehicle is garage-scoped. `assertUsableVehicle()` in `data/base.ts` therefore
cannot use the ledger predicate — it asks whether the vehicle is in a garage
the **caller** is a member of.

This is the only write path where a cross-portal leak could hide, and since
2026-09-03 it also **returns the garage id**, which is load-bearing rather than
convenient. See below.

### A fill-up WRITES into Odometry

Marking an entry a fill-up captures an odometer reading and litres, and
`TransactionRepo.create` writes them into Odometry's `odometer_readings`,
`fuel_fills` and the cached odometer on `vehicles`.

**`docs/coinbox-spec.md` §7.2 deferred exactly this**, on the grounds that
coupling the two portals' write paths is the half that can leak. It was reopened
deliberately, for fuel only: the alternative is keying the odometer twice in two
apps, and an odometer nobody keeps entering is the top-rated product risk in the
fleet spec (§11.7). Service records still carry no `transaction_id`.

Three things hold it up, and `tests/fuel.test.ts` breaks each on purpose:

1. **The garage id comes off the vehicle row**, in the same statement as the
   `garage_members` join that authorised it. Never from the scope — which has
   no `garageId` and must never grow one. The test that proves this needs a
   co-member who ALSO has their own garage; without that second garage the two
   ids are the same string and the test passes either way.
2. **The reading cannot run backwards.** Shared with Odometry, in
   `packages/core/src/worker/odometer.ts`.
3. **It is ONE `batch()`.** A rejected fill leaves no transaction, no reading
   and no fill. Money without its litres, or an odometer that moved for an entry
   that does not exist, are both worse than a plain failure. Note that every
   validation rejects *before* any statement runs, so the API-level tests cannot
   prove this — the one that does drives the repository directly with litres the
   database refuses.

**`fuel_fills` has no money column.** It is garage-scoped and a garage is
shared, so a price there would be readable by every co-member. Coinbox derives
price per litre by joining its own money; Odometry never shows a price.

**`fuel` is absent from `transactionPatch`.** Odometer readings have no
correction path in Odometry either, so this is consistent rather than a new gap:
to fix a mistyped fill, delete the entry and re-enter it. The `ON DELETE
CASCADE` takes the fill and **leaves the reading** — the car really was at that
mileage on that day.

**The fill-up trigger is a toggle, not a category.** There is no `fuel`
category and adding one would split five years of history — every fuel row in
the export is Transportation. See `src/shared/fuelRules.ts`, whose rules mirror
`categoryRules.ts`: hiding the block clears its values, because a hidden control
that keeps its value still submits it.

## Vocabulary

**Money direction is `in` / `out`.** Not debit/credit, not income/expense.

Debit and credit are genuinely ambiguous: by ledger convention a debit
increases an asset account, but a bank statement is written from the bank's
perspective and shows money arriving as a credit. Same word, opposite meanings,
both correct. They only earn their keep in double-entry, where every
transaction has two sides that must balance — this is a single pooled account
and a flat log, so there is no second side and nothing to balance.

Not `income`/`expense` either: categories are deliberately **not** bound to
direction, so naming the direction after a category-like concept would quietly
re-couple them.

## Domain rules

### Store magnitude plus direction; derive the sign

`amount_sen INTEGER NOT NULL CHECK (amount_sen >= 0)` with `direction TEXT NOT
NULL CHECK (direction IN ('in','out'))`, plus a `VIRTUAL` generated column
`signed_sen`.

The positive-magnitude constraint makes a sign error impossible at write time,
which matters because a missed negation on one insert path is silent rather
than visible. The generated column keeps aggregation to `SUM(signed_sen)` with
no `CASE` repeated across queries and no chance of two reports disagreeing.

### Never render a negative number in the UI

Show magnitude with a colour and a prefix. The entry screen leads with two
large direction buttons, defaulting to `out` since that is the overwhelming
majority of rows — a miscategorised inflow should be visually obvious rather
than buried in a dropdown.

### Categories are not bound to direction

Any category may appear as either `in` or `out`. Do not add a `direction`
column to `categories`, and do not filter the category picker by the selected
direction.

**This is measured, not asserted.** In the owner's real export four categories
appear as both: `Household` (2 in / 68 out), `Miscellaneous` (12/3), `Family`
(1/16), `Savings` (2/8). A schema binding direction to category could not hold
his own data. `tests/schema.test.ts` asserts the column's absence.

**The picker REORDERS by direction; it must never filter.** Asked for directly
in 2026-08, and the answer was to give the ergonomics without the cost:
`partitionByDirection()` floats the likely categories under a "usually money
in/out" group and leaves the rest under "Other". Filtering instead would make
these five real entries unenterable —

| Date | Category | Dir | |
|---|---|---|---|
| 17 Jan | Household | in | RM 2,500 from Mom, porch tilings |
| 24 Jan | Household | in | RM 3,000 from Mom, roof |
| 02 Mar | Savings | in | KWSP Akaun 3 withdrawal |
| 02 Mar | Savings | in | Wahed withdrawal |
| 22 Mar | Family | in | From Kdik, Raya packets |

— plus three outbound Miscellaneous penalties. The person would have to pick a
wrong category, save, then edit it, which is worse than a longer list.
`tests/form-logic.test.ts` asserts no category is ever dropped in either
direction.

### Import provenance is not editable

`source_type_raw` and `source_category_raw` record what the Sheet said —
including for the three rows deliberately recategorised on the way in. They are
absent from `transactionPatch`, which is `.strict()`, so an edit cannot rewrite
them. Losing them would destroy the only evidence of what was imported versus
what was corrected afterwards.

`transactions.is_recurring` is provenance too, and is absent from
`transactionPatch` for the same reason: it records that the nightly job wrote
the row, so an edit must not be able to forge it. Editing an auto-posted
entry's amount leaves it flagged, because it *was* auto-posted — that is a fact
about its origin, not about its current values.

## Recurring entries

### The month-end clamp CANNOT be written in SQL

**`date('2026-01-31','+1 month')` returns `2026-03-03`, not `2026-02-28`.**
Measured against the real database, not assumed. SQLite normalises an
impossible date forward; it does not clamp. `date('2026-03-31','+1 month')` is
`2026-05-01`.

The owner asked for 31 → 28/29 Feb → back to 31 in March, so the schedule
arithmetic lives in `src/shared/recurrence.ts` and **nothing computes a due date
in SQL**. This is a real exception to "aggregate in SQL, never in JavaScript",
written down here because that invariant is standing instruction and someone
will eventually try to honour it in this one place. The failure it prevents is a
payment three days late, once a year, with nothing in any log.

The second half of the same trap: **each occurrence is computed from
`day_of_month` against its own month, never from the previous occurrence.**
`addMonths` in `@portals/core` clamps correctly, but iterating it drifts — once
a day-31 rule clamps to 28 Feb it yields 28 Mar, and sits on the 28th for the
rest of its life. `tests/recurrence.test.ts` asserts the round trip, not just
the February step, because the one-step version passes against exactly that bug.

### `(rule_id, occurred_on)` is the idempotency guarantee

The primary key on `recurring_postings` is the only thing that makes the
nightly run safe to repeat — the cron can fire twice, be retried, or overlap,
and careful code is not a substitute. Two consequences:

- **Never `INSERT OR IGNORE` the claim.** The claim would be skipped while the
  transaction insert succeeded, producing exactly the double-post the table
  exists to prevent. It must be able to throw.
- **The transaction is inserted BEFORE the claim, and the order is forced.**
  `recurring_postings.transaction_id` references `transactions(id)`, and D1
  enforces foreign keys statement by statement — it ignores
  `PRAGMA foreign_keys = OFF`. Claiming first fails with
  `SQLITE_CONSTRAINT_FOREIGNKEY`. Ordering costs nothing because the guarantee
  comes from `batch()` being atomic, not from the order.

Unlike `import_rows`, this key needs nothing extra. That hash includes the
source line number because two genuinely identical rows exist in the owner's
export; here two occurrences of one rule are at least a month apart by
construction, so the collision is arithmetically impossible.

### Deleting a rule must never reach the money

`recurring_postings` cascades from `recurring_rules`; `transactions` does not,
and carries no `recurring_rule_id`. The money was real whatever happens to the
schedule that caused it. `is_recurring` is what lets those entries still say how
they got there once the rule and its claims are gone.

### The cron re-checks the vehicle, every time

A rule's `vehicle_id` is authorised at creation and **re-validated against the
ledger owner on every post**, because those are months apart and garage
membership can change in between. Without the second check, revoking someone's
garage access would revoke nothing — the scheduled writer would keep stamping
the owner's vehicle into their ledger indefinitely. On failure the entry posts
**without** the vehicle: the payment is real and must be recorded, and dropping
attribution fails in the safe direction.

## Pages

Three top-level routes, in `src/client/App.tsx`:

| Route | Component | What it is |
|---|---|---|
| `/` | `routes/Home.tsx` | The dashboard. One `GET /api/dashboard` payload; see below |
| `/ledger` | `routes/Ledger.tsx` | The log. Inline cell editing, filters, delete |
| `/recurring` | `routes/Recurring.tsx` | Declared rules. Edit, pause/resume, delete |

The header comes from `@portals/core/client`. Coinbox passes `nav` (the three
sections) and `crumbPlacement="below"`, which puts the breadcrumb on its own
row inside the same sticky header. Both are additive props defaulting to the
old behaviour, so **Odometry renders exactly as it did** -- do not "tidy" them
into always-on.

`homeLabel` is `"Home"`, not `"Ledger"`: it is the label the breadcrumb uses
for whatever `/` is, and `/` is Home now.

Every page's title row carries `pt-6`. It is the only thing keeping the three
pages' headings and action buttons on the same line; Ledger was missing it once
and its button sat 24px high.

## The dashboard

Built 2026-08-31. It replaces the half of the Google Sheet that was not the
log: the monthly surplus/deficit table and its Total row.

`GET /api/dashboard[?month=YYYY-MM]` returns the whole page in one payload.
`DashboardRepo` in `data/dashboard.ts` owns every query; the route computes
`todayIn(scope.timezone)` and passes it down, so nothing underneath decides
what day it is.

**Nothing here is a view, deliberately.** Every figure is relative to a month
the caller picked or to their local today, and a view takes no parameters --
the same reason Odometry's usage rate is a CTE in `status.ts` rather than in
`0002_views.sql`. `v_txn_monthly` supplies the parameter-free half.

Five things that will look like bugs and are not:

- **The category breakdown ranks by AMOUNT, not by departure from normal.**
  Until 2026-09-07 it did the opposite: each category against its own
  three-month average, biggest effect first. That answered "was this month
  odd?", and the owner's question is "where did it go?" — the question his
  Google Sheet pivot answered. Do not reintroduce the vs-normal ranking as the
  primary panel; it is in git history at `9be2459~1` if the reasoning is ever
  wanted, and `docs/coinbox-spec.md` §10.3 records why it went.
- **`categorySpend` keeps `in` and `out` apart and never nets them.** The old
  query read `net_sen` only, so a category taking money both ways in one month
  cancelled itself out — and four of the owner's categories genuinely do that.
  The reader picks a direction; the query decides nothing.
- **Its "drop empty categories" filter is outside the aggregate, in a
  subquery, and must stay there.** `in_sen` and `out_sen` are both aggregate
  aliases *and* real columns of `v_txn_monthly`, so `HAVING in_sen > 0`
  resolves to the SOURCE column and lets a category whose only money was last
  month through. Measured on 2026-09-07, not feared.
- **Staleness is measured from the last TYPED entry**, never the last row.
  Once rules are posting the ledger grows whether or not anyone opens the app,
  so the newest row of any kind would report the page as current while a
  fortnight of real spending is missing.
- **"Committed" leaves SQL**, and it is the same documented exception as the
  cron: the month-end clamp is unexpressible in SQLite, so the projection uses
  `@shared/recurrence`. It loops over RULES, which are a handful, not over
  transactions.

### The cross-portal READS -- there are two, and both carry two guards

**Cost per kilometre** (`DashboardRepo.vehicleCosts`) and the **fuel
drill-down** behind it (`VehicleFuelRepo`, `GET /api/vehicles/:id/fuel`). The
spend is this ledger's, the distance and the litres are Odometry's.

Each carries two independent guards, and `tests/isolation.test.ts` breaks each
one separately, because `transactions.vehicle_id` deliberately has no foreign
key and can therefore outlive the caller's access to that vehicle:

1. **A `garage_members` join for the caller** -- inline on the cost-per-km
   query, via `assertUsableVehicle()` on the drill-down, which returns the
   garage id off the vehicle row in the same statement that authorised it.
2. **The `ledger_id` predicate on every money join.**

The drill-down is the sharper case. `fuel_fills` is garage-scoped, so a
co-member is **entitled to the litres** -- Odometry already shows them. What
they must never get is the ringgit. So this is the one endpoint in either
portal where the two halves of a single physical event, the fuel and what it
cost, are served together and have to come apart along the tenant boundary.
A co-member gets `amountSen: null` on every fill and an empty spend
breakdown, and the money predicate lives in the JOIN's `ON` clause rather than
a `WHERE` -- in a `WHERE` it becomes an inner join and hides their fills
entirely instead of merely unpricing them.

**The drill-down's spend breakdown sums to the card's figure**, by using the
same window and the same predicates. A test asserts it. Two numbers on one
screen that are meant to be the same number can only stay equal on purpose.

## Style

Entry happens on a phone at a petrol pump or a checkout, so the entry flow
stays fast and full-width at every breakpoint even though the layout is
desktop-first.

The header uses body type and that is settled, not pending — Odometry's
Bukhari Script is subset to its own eight letters and licensed for personal use
only, so it cannot be reused. `docs/coinbox-spec.md` §7.5 closes this; do not
reopen it as an outstanding task.
