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

Still unbuilt: every transaction endpoint and the entry form. `GET /api/me`
remains the only route, so **the isolation suite has nothing new to cover
yet** — the moment a read endpoint lands, it goes in `tests/isolation.test.ts`.
No exceptions.

## Scope line

This is an expense ledger, **not a personal finance app**. Out of scope: account
balances (the banks have no API, so reconciliation is not feasible), budgets,
net worth, loan amortisation, multi-currency, recurring-transaction detection.
Parity with the Google Form, plus the things the Form cannot do: conditional
fields, editing past entries, real validation, and vehicle attribution as a
first-class field.

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

This is the only write path where a cross-portal leak could hide. Nothing calls
it yet; it is written because it is the subtlest rule here.

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

`amount_sen INTEGER NOT NULL CHECK (amount_sen > 0)` with `direction TEXT NOT
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

## Style

Entry happens on a phone at a petrol pump or a checkout, so the entry flow
stays fast and full-width at every breakpoint even though the layout is
desktop-first.

The header uses body type and that is settled, not pending — Odometry's
Bukhari Script is subset to its own eight letters and licensed for personal use
only, so it cannot be reused. `docs/coinbox-spec.md` §7.5 closes this; do not
reopen it as an outstanding task.
