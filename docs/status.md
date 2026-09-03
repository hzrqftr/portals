# Status

Where the project actually is, and what to pick up next. The specs say what to
build; this file says how much of it exists.

**Last updated:** 2026-08-31 (Coinbox Home dashboard built, merged and deployed)

---

## The workspace split is merged

**As of 2026-08-28 the two-portal workspace is on `main`.** The
`workspace-split` branch fast-forwarded in — six commits, no divergence, no
conflicts. A fresh clone now sees both portals.

### What those six commits did

| Commit | What |
|---|---|
| `bb9c87f` | Moved Odometry to `apps/odometry`, npm workspaces, `migrations/` and `.wrangler/state` to the root |
| `d3f3668` | Extracted `packages/core` — one `getAuthenticatedUser()` across both portals, generic `BaseScopedRepo` |
| `8f19f63` | Coinbox skeleton: `ledgers` table, ledger-scoped repo, isolation suite, docs |
| `d48b38c` | Wrote this handover into `docs/status.md` |
| `93361f1` | Updated the handover for the repo rename and the push |
| `3f889e9` | Recorded the then-outstanding local folder rename |

Everything was verified, not assumed:

- Odometry is behaviourally unchanged — **73 tests before the move, 73 after**.
- Migration ledger intact: `wrangler d1 migrations apply` reported nothing to
  apply after `migrations/` was relocated (the ledger stores bare filenames).
- The isolation lint and the Coinbox isolation suite were each **made to fail
  on purpose and then restored**. A passing check proves nothing until it has
  been seen to fail.
- Clean clone → `npm ci` → `npm test` is green.

### The folder rename is done

The local folder is now `github/portals`, matching `hzrqftr/portals` on GitHub.
The `github/coinbox` signpost — one README, no code — was deleted on
2026-08-28, both of its reasons to exist having gone.

One consequence is worth remembering, because it will happen again to anyone
who moves this folder: **npm workspaces link on Windows as junctions with
absolute targets.** After the rename all three
(`node_modules/@portals/core`, `node_modules/odometry`,
`node_modules/coinbox`) still pointed into the old `github/odometry` path and
silently dangled. The isolation lint still passed, then `tsc` failed with
`Cannot find module '@portals/core'` about eighteen times. `rm -rf node_modules
&& npm ci` rebuilds them. Junctions are not in git, so a fresh clone never has
the problem — this is strictly a "moved the folder" concern.

`.wrangler/state` needed nothing: it resolves relative to the repo root, so the
local D1 and its data moved with the folder and no migration was re-applied.

## Coinbox is live on the real ledger — 2026-08-28

**The Google Form can be retired.** Coinbox holds the complete history and
every entry path the Form had, plus the four things it could not do.

| | |
|---|---|
| Transactions in production | **4,421** |
| Span | 2022-01-03 → 2026-08-28, 56 months |
| Money in / out | RM 350,805.89 / RM 350,809.67 |
| Net | −RM 3.78 |
| Categories | 20, seeded globally |
| Vehicle-attributed | 699 |

Reconciled exactly on the first production run, against figures written into
`docs/coinbox-spec.md` §6 **before** the importer existed. Foreign key check
clean. Both portals still 302 to Access.

### What the full history changed

The 2026-only sample it was all built against was wrong about three things.

1. **A zero amount is real data.** `CHECK (amount_sen > 0)` rejected eight
   RM 0.00 water bills, recorded on purpose so a monthly-average dashboard has
   a value for every month. The constraint is now `>= 0`; the guard that was
   actually wanted — blank versus typed zero — moved to the form and the table,
   where the slip happens.
2. **A default tuned on a slice lied.** Miscellaneous is 12 in / 3 out across
   2026 and 34 in / 66 out across five years. It defaulted to `in`; it now
   defaults to `out`.
3. **Four categories were missing** — Accommodation, Dividend, Fundings, Debt
   appear only before 2026.

### Import decisions, for the record

- The **"Elai's" row** (12-May-2022) was dropped: a restaurant name landed in
  the Amount column and no figure is recoverable.
- **Six duplicate pairs** were double submissions; the second of each was
  dropped, worth RM 102.83. That is the whole difference from the Sheet's
  totals, so an import matching the Sheet exactly would be wrong.
- **124 ambiguous `Car fuel` rows → the City.** An **owner decision, not
  evidence**: the file names the Waja 44 times to the City's 33 and leans Waja
  heavily in 2023. Recorded here so four years of attribution is never mistaken
  for something the Sheet said.

### Still on the Sheet, deliberately

The owner is dropping the **Form**, not the **Sheet**.

**Narrowed on 2026-08-31.** The monthly surplus/deficit table and its totals —
the main reason the Sheet was still being opened — are now the Home dashboard.
What remains on the Sheet is ad-hoc analysis: arbitrary slicing, and a copy
readable on a phone without going through Access. Coinbox is the system of
record for entries either way.

---

### Fuel capture and consumption (2026-09-03)

A Coinbox entry can now be marked a fill-up, capturing **odometer, litres and
whether the tank was filled**. The odometer lands in Odometry through the same
validated path the quick-update flow uses; the litres land in a new garage-scoped
`fuel_fills` table (migration `0013`). Odometry's vehicle page grows a **Fuel**
tab showing each fill with the consumption of the segment it closes.

Three decisions worth not re-litigating:

- **All three fields were captured together on purpose.** Odometer plus ringgit
  gives cost per km, which already existed. Litres per 100 km needs volume, and
  it needs `is_full_tank` — consumption is only computable full tank to full
  tank, and a partial fill divided by its own distance produces a number in an
  entirely plausible range that is simply wrong. Shipping the odometer first and
  the litres later would have left a permanent hole in the series, because none
  of this is backfillable.
- **`fuel_fills` carries no money column.** It is garage-scoped and a garage is
  shared, so a price there would be readable by every co-member. The ringgit
  stays on `transactions` behind the ledger predicate.
- **The trigger is a toggle, not a new category.** There is no `fuel` category
  and adding one would split five years of history — every fuel row the owner
  has is Transportation.

Not built yet: the Coinbox-side consumption analytics (month over month). It
reads only data now being captured, so it can be built whenever.

## What is deliberately NOT built

Everything in `docs/coinbox-spec.md` §4 IS built as of 2026-08-28 — this
section used to say the opposite and was the stale part of this file. What
remains deliberately absent:

- ~~**The reverse Odometry link.**~~ **PARTIALLY REOPENED 2026-09-03, for fuel
  only.** Service records still carry no `transaction_id`, and §7.2's reasoning
  still holds for them. What changed is that a Coinbox fill-up now WRITES into
  Odometry — an `odometer_readings` row, a `fuel_fills` row and the cached
  odometer on the vehicle, all in one atomic batch with the transaction.

  The trade was made knowingly: the alternative is keying the odometer twice, in
  two apps, and an odometer nobody keeps entering is the top-rated product risk
  in the fleet spec (§11.7). Three guards carry it, and
  `apps/coinbox/tests/fuel.test.ts` breaks each one on purpose — the garage id
  is read off the vehicle row the membership join proved, never off the scope;
  the reading cannot run backwards; and the whole write is one `batch()` so a
  rejected fill leaves no transaction, no reading and no fill.
- **`ledger_members`.** Sharing a ledger is unrepresentable on purpose. Adding
  it is a product decision, not a refactor.
- ~~**Deleting a transaction.**~~ **BUILT 2026-08-30, and this deferral was
  reopened deliberately.** Recurring entries are the reason: a rule that posts
  without confirmation will eventually post something wrong, and editing that
  entry to RM 0.00 is not an undo -- it leaves a row asserting a payment that
  never happened, still counted in `v_txn_monthly`. Auto-post without delete is
  the unsafe combination, so the two shipped together.

  Hard delete, not a `deleted_at` flag: a soft delete would need
  `WHERE deleted_at IS NULL` in `list`, `get`, `monthlySummary`, both views and
  every report written from here on, and a single omission silently returns a
  deleted row to a total. Recovery is the nightly R2 export (90 days) plus D1
  Time Travel (30) -- a file the owner already has.
- **Budgets** (§8.6, Phase 2) and **multi-user** (Phase 3).

## Blocked on the owner — cannot be done from a coding session

**Nothing is blocking.** Every dashboard task is done: `wrangler login`, the
Coinbox Access application and its AUD tag, and the `portals-backup` R2 bucket.

One optional item remains, and it is cosmetic: a **Coinbox wordmark**.
Odometry's Bukhari Script woff2 is subset to its own eight glyphs and licensed
for personal use only, so it cannot be reused. Coinbox uses body type and looks
fine. `docs/coinbox-spec.md` §7.5 closes this — do not reopen it as a task.

### Cleared on 2026-08-28

- **`wrangler login`** — done. The CLI is authorised again; `whoami` reports
  `hazriq.fitri95@gmail.com`, account `d635376dc2be247b10234d81a23a15f5`.
- **The Coinbox Access application** — created, owner-only policy
  `coinbox-allowlist`, its AUD tag now in `apps/coinbox/wrangler.jsonc`.

## Traps in the current state

- ~~**`0012_recurring.sql` is applied LOCALLY ONLY.**~~ **RESOLVED.** All of
  `0001`-`0012` are applied both locally and remotely; checked on 2026-08-31
  with `npx wrangler d1 migrations list fleet --remote -c wrangler.jsonc`,
  which reported nothing to apply. The dashboard added no migration, so there
  is currently no gap between the two. Re-run that command before believing
  this line — it is the only cheap way to know.
- **A git worktree makes the isolation lint fail with ~100 bogus violations,**
  because `.claude/worktrees/<name>/` is a full second copy of the tree and the
  allow lists are anchored regexes. Fixed on 2026-08-31 by putting `.claude`
  in `SKIP_DIRS`. If you see it anyway, you are on a checkout from before that
  fix: run `git worktree list` before believing a single finding. See the root
  `CLAUDE.md`, "Known traps".
- **Coinbox now has a Cron Trigger**, `0 17 * * *`, and `observability` is on
  for that Worker. Two things follow. A newly registered cron takes **~15
  minutes** to start firing, so do not debug silence before checking how long
  ago it deployed. And the 17:00 UTC recurring run must stay **before**
  fleet-portal's 18:00 UTC backup, so the night's auto-posted entries are in
  that night's dump.
- **The first production recurring run will post nothing**, because forward-only
  means no rule can be due before it is created. A healthy quiet run is
  distinguishable from a broken one only by the log line, which always reports
  how many rules were *considered*, not just how many posted.
- **Both apps share `.wrangler/state` at the repo root**, because they share
  one D1 in production. If either app starts creating its own, a transaction
  will not be able to see the vehicle it references.
- **Both dev servers want port 5173.** Run one at a time.
- **`npm test` at the root runs everything**; `npm test -w odometry` runs one
  app. The root `test` is what `npm run deploy -w <app>` calls, deliberately —
  both portals share a database and `packages/core`.

---

## Live system

This repo is a **workspace with two portals** sharing one D1 database. See the
root `CLAUDE.md`, "One database, one repo".

| | |
|---|---|
| Repo | `hzrqftr/portals`, private, branch `main` |
| Odometry app | https://fleet-portal.hazriq-fitri95.workers.dev |
| Coinbox app | https://coinbox.hazriq-fitri95.workers.dev — LIVE with the full ledger, recurring entries and the Home dashboard, owner-only |
| Workers | `fleet-portal`, `coinbox` |
| Database | D1 `fleet` (`e4bdd9c3-e885-42de-a709-4daf8f4a6edb`) |
| Access team | `effortless-hf95.cloudflareaccess.com` |
| Access apps | fleet-portal → policy `fleet-portal-allowlist` (household); coinbox → policy `coinbox-allowlist` (owner only) |
| Identity provider | Google (not Google Workspace) |

**Both portals are deployed and Access-protected as of 2026-08-28.** Coinbox
has its own Access application and its own audience tag, with the policy
`coinbox-allowlist` admitting the owner alone — deliberately narrower than
Odometry's, which admits the household so a fleet can be co-owned.

The two AUD tags differ, and must keep differing: accepting the other portal's
audience would let a token minted for the fleet portal open the ledger.

Verified at deploy time rather than assumed: unauthenticated requests to
Coinbox return `302` to
`effortless-hf95.cloudflareaccess.com/cdn-cgi/access/login/...`, with the
redirect's `kid` matching the configured AUD; Odometry was unaffected
throughout.

**Migration `0010_ledgers.sql` is now applied remotely.** Production went from
17 tables to 18; views, users, garages and vehicles were unchanged, as expected
for a migration that only adds a table and an index. `ledgers` is empty until
someone signs in to Coinbox and the bootstrap runs.

Production schema: 15 tables, 4 views, 61 seeded part types across 11
categories, 83 part-type defaults, foreign keys enforced. Local adds
`ledgers` (16 tables).

Data currently in production: one user, one garage, three vehicles (Waja and
City, both `vehicle_type = 'car'`, and an RS150R, `'motorcycle'`), 96
maintenance intervals, and **no odometer readings, no service history and no
renewals**. Every maintenance row is therefore `unknown`, which is correct
rather than broken — see the "no baseline" trap in CLAUDE.md. Services can be
logged from the UI, so this is a starting state rather than a permanent one.

Note that the developer's LOCAL database is a different and much fuller thing:
`.wrangler/` is gitignored, so whatever a previous machine had — test vehicles,
service records, hand-edited intervals — does not travel with a clone. A fresh
checkout starts empty and that is correct.

---

## What works

Verified against the deployed app, not just the test suite.

- Cloudflare Access sign-in via Google, restricted to an email allowlist
- First-login bootstrap: user, garage, owner membership, default settings
- Dashboard: attention list, vehicle cards, stale-odometer warnings
- Add a vehicle, with intervals seeded from part-type defaults filtered by fuel
- Quick odometer update from the dashboard (§8.5)
- Vehicle detail: nickname, odometer, maintenance list, service history
- **Log a service** (§8.4): date, odometer, service type, workshop, line items,
  part picker pinning the vehicle's due parts, brand autocomplete, and a save
  confirmation naming which clocks were reset
- **Labour as its own cost** (migration 0006): entered separately from the
  parts, which covers the common case of supplying your own oil and filter and
  paying a workshop for the fitting alone. The grand total is computed as
  parts + labour on read — there is no stored `total_cost` any more, so no two
  figures can disagree
- **Motorbikes** (migration 0008): `vehicles.vehicle_type`, and a
  `part_type_defaults` table keyed by (part type, vehicle type) that decides
  both which parts a vehicle has and on what schedule — the same
  `pt_engine_oil` is 10,000 km on a car and 3,000 on a bike. 13 bike-specific
  parts; chain and CVT parts both ship un-seeded since a bike is one or the
  other and nothing in the schema says which. Car-only parts (cabin filter,
  aircon, wipers, ATF, power steering, CV boots, car suspension) no longer
  exist for a bike at all
- **Wear-and-tear parts, grouped** (migration 0007): 48 global part types,
  including suspension and steering (absorbers, mounts, stabiliser links and
  bushes, lower arm bushes, ball joints, tie rod and rack ends), drivetrain
  (CV boots, engine mounts, wheel bearings), cooling and engine servicing.
  Four new categories carry them, and the maintenance list is grouped by
  category with anything overdue or due soon pinned above the groups. Parts
  that depend on the car rather than the fuel -- clutch, differential, rear
  drums, coil springs -- ship with no default interval so they stay opt-in
- **One interval per part** (migration 0005): the interval keyed in at a
  service becomes the vehicle's interval, stored as an interval so the due
  point stays derived. Replaced the earlier per-service *override*, which gave
  one part two competing schedules and made an edited interval look like it
  had not saved
- **Per-vehicle interval editing** inline on the maintenance list, including
  switching a part off and tracking one the seeder skipped — this is how the
  Waja's timing belt and the City's timing chain are told apart
- **Settings** (§8.7): due-soon thresholds, stale-odometer threshold, assumed
  km/day fallback, timezone, currency, and the minor/major parts templates
- Part warranty in months, shown as a badge on the service history line item
- **Dark, desktop-first UI** (2026-08-21): one wide responsive layout, a shared top bar,
  and the vehicle maintenance list rebuilt as a grid of tiles with category icons and a
  All / Needs attention / Not set up filter. Twenty parts used to be ~2,000px of stacked
  cards; they now fit one screen on a laptop.
- **Part search on the maintenance tab** (2026-08-22): a search box above the
  grid filters the tracked tiles and the not-tracked list together, by part
  name. A car tracks around forty parts across eleven categories, which meant
  scrolling to find one even after the tile rebuild. It filters an array
  already in memory and does not re-sort it, so the server's
  overdue → due_soon → ok → unknown ordering and invariant 4 both stand
- **Battery folded into Electrical** (migration 0009): `battery` was a category
  with exactly one member, while spark plugs and ignition coils already sat
  under `electrical`. A plain data `UPDATE`, not a rebuild — `electrical` was
  already legal under the category `CHECK`. Eleven categories now, not twelve
- **Nightly whole-database backup to R2** (2026-08-28): a Cron Trigger on
  fleet-portal exports every table as JSON to `portals-backup`, keyed
  `fleet/YYYY-MM-DD.json`, keeping 90 days. One D1 means one backup covering
  both portals. Table discovery reads `sqlite_master` rather than a hardcoded
  list, so a table added later is included without anyone remembering.

  Retention is 90 days because **D1 Time Travel was measured at 30** — not
  assumed, which both specs had asked for. The export earns its place on what
  Time Travel cannot do: outlive 30 days, survive loss of the Cloudflare
  account, and be a file you can read and move.

  `scripts/restore.mjs` is the operator path, and the round trip runs on every
  `npm test`. It was also exercised against **production**, not just locally:
  the cron wrote `fleet/2026-08-28.json` (47 KB, 15 tables), that object was
  pulled from R2 and restored into the local database, and local came back
  holding production's 3 vehicles and 96 maintenance intervals -- 255 rows,
  foreign key check clean. That is the drill §7.6 asks for, done end to end.

  `observability.enabled` is on for this Worker so a failed nightly run leaves
  a log behind. It is the one job here with nobody watching it.
- Every Phase 1 API endpoint
- 73 tests: tenant isolation, derived logic, and the Access JWT fallback

---

## What is not built

The API is complete for Phase 1. All of the following are **client gaps** —
the endpoints exist and are covered by the isolation suite.

| Gap | Spec | Why it matters |
|---|---|---|
| Renewals | §4.6, §6.3 | Road tax and insurance are half the reason the app exists |
| Vehicle delete | §10 | Editing is built (Details → Edit details); deleting is not. `DELETE /api/vehicles/:id` archives and is isolation-tested, but nothing calls it |
| Add-vehicle baseline prompt | §8.3 | Spec says prompt for baselines after saving; it currently saves and dismisses, which is how all three vehicles ended up with no odometer |
| Inline odometer edit, usage rate | §8.2 | The Details panel now shows the spec, but the odometer can only be changed from the dashboard, and the usage rate with its confidence indicator is not surfaced anywhere |
| Editing a service after saving | §8.4 | `servicePatch` omits `items`, `odometerKm` and `servicedOn`, so fixing a line item means deleting and re-logging the visit |
| Custom part types in the UI | — | `POST /api/part-types` exists and is isolation-tested, but nothing calls it yet; the 61 seeded types cover the common cases |
| Per-vehicle service templates | §8.4 | `service_templates.vehicle_id` exists and is always NULL; templates are garage-wide for now, which also means one "Minor service" template is shared between a car and a bike |
| Changing a vehicle's type | — | Read-only once created, deliberately: switching it would not re-seed or un-seed anything, so a control that appeared to turn a car into a bike while leaving forty car parts behind would be lying. Delete-and-recreate for now |
| `Sheet`'s close button (both portals) | — | `packages/core/src/client/Sheet.tsx` floats its X in a zero-height row, so every caller must remember `pr-9` to stay clear of it, and must render its own `<h2>` because `title` is only an aria-label. Three of five callers remember; **`OdometerSheet` and `ServiceSheet` are correct only because their headings are short** — a longer vehicle nickname reproduces the collision Coinbox hit on 2026-08-28. Reviewed and deliberately deferred: the real fix is `Sheet` rendering the title itself, which touches five files and needs judgement in `ServiceSheet` (its saved-state screen) and `PartDetailSheet` (its pill header) |

Deferred by design: Budgets (§8.6) is Phase 2, multi-user is Phase 3, backups
and reminders are Phase 4.

### Coinbox

**This table was badly out of date and was rewritten on 2026-08-30.** It still
listed the schema, the entry form and the import as unbuilt, which the sections
above it and production both contradict. If you are reading it against
something that looks wrong, trust the code.

| Gap | Spec | Why it matters |
|---|---|---|
| ~~`transactions` + `categories` schema~~ | §4.2, §4.3 | **BUILT 2026-08-28**, migration `0011`. 4,421 rows in production |
| ~~Entry form~~ | §1.1 | **BUILT 2026-08-28.** Conditional vehicle field, direction-reordered category picker, inline cell editing |
| ~~Sheet import~~ | §6 | **DONE 2026-08-28.** 4,421 rows reconciled exactly. The triage screen was not needed — the real count was 14, not ~80 |
| ~~Backup + restore~~ | §7.6 | **BUILT 2026-08-28.** Nightly whole-database export to R2, 90-day retention, restore round trip in CI |
| ~~Recurring entries~~ | §9 | **BUILT 2026-08-30.** Declared rules, nightly cron, delete. See below |
| The Sheets mirror | §7.6 | Still open. A readable copy on a phone without the app; needs a Google service account and JWT signing in the Worker |
| Backup failure alerting | — | A failed nightly run writes to the log and tells nobody. Needs an email provider |
| Off-Cloudflare backup copies | — | Every backup is in the account it protects. One downloaded file a month closes it |
| ~~Home dashboard~~ | §10 | **BUILT AND DEPLOYED 2026-08-31.** The surplus/deficit table as a chart, a month drill-down, and cost per km. See below |
| Cross-portal navigation | §7.4 | `AppHeader` takes a `portals` prop nothing passes. Blocked on Access groups reaching the Worker |

---

## Recurring is live, and the first posts land 31 August

**Deployed 2026-08-30.** Version `2df53a95`, cron `0 17 * * *` registered on the
coinbox Worker. The owner has entered **nine real rules** totalling
**RM 4,415.32 a month**. As of the evening of 2026-08-30, `recurring_postings`
is empty and no transaction carries `is_recurring = 1` — correct, because
forward-only means nothing can be due before its rule was created.

| Rule | Amount | Day | First post |
|---|---|---|---|
| AKPK | RM 240.00 | last day | **2026-08-31** |
| Family fund | RM 200.00 | last day | **2026-08-31** |
| ASB | RM 50.00 | 5th | 2026-09-05 |
| House loan | RM 2,910.00 | 5th | 2026-09-05 |
| Balance transfer | RM 311.32 | 9th | 2026-09-09, last 2027-06-09 |
| MARA | RM 250.00 | 15th | 2026-09-15, last 2027-05-15 |
| House insurance | RM 170.00 | 24th | 2026-09-24 |
| Etiqa | RM 230.00 | 26th | 2026-09-26 |
| Astro | RM 54.00 | 30th | 2026-09-30 |

**AKPK and Family fund post on the night of 30 → 31 August**, and that run is
the first end-to-end proof the cron works in production. Two entries totalling
RM 440 should appear dated `2026-08-31`, marked with the recurring glyph. If
they do not, check how long ago the Worker deployed before anything else — a
newly registered trigger takes ~15 minutes to start firing.

### Two rules the owner should confirm, and a new agent must NOT silently "fix"

Both are data, not bugs; the system is doing exactly what the rows say. They are
recorded here because they look like slips and someone will otherwise either
ignore them or edit production on a guess. **Ask before changing either.**

- **Astro** — `day_of_month = 30` but `starts_on = 2026-09-05`. The first post
  is therefore **30 September, not the 5th**. If the 5th was intended, the day
  is wrong; if the 30th was intended, this is fine and the start date is just
  the day it was entered.
- **MARA** — `ends_on = 2027-06-05` with `day_of_month = 15`, so the last post
  is **15 May 2027**, not June. Compare Balance transfer, whose `ends_on`
  (2027-06-09) matches its day and therefore does include a final June payment.
  If MARA is meant to run to June, its end date needs to be on or after
  2027-06-15.

## The Home dashboard is built and live — 2026-08-31

`/` was empty and is now the dashboard. Spec §10 has the design; the app's
`CLAUDE.md` has the four rules that will look like bugs and are not.

**Deployed to production 2026-08-31**, Worker version
`1115cd1d-176e-4d64-b29d-3d1a668f05a0`. `main` fast-forwarded to `9613e43`, no
merge commit. `wrangler d1 migrations list --remote` reported nothing to apply
both before and during the deploy — this change adds no migration, so the
production database was not touched. The nightly cron (`0 17 * * *`) and
`ENVIRONMENT=production` both survived the deploy.

**No migration.** Everything is derived from `v_txn_monthly` and existing
tables, so there is nothing to apply and nothing new to back up.

What landed:

| Piece | Where |
|---|---|
| `GET /api/dashboard[?month=]` | `worker/routes/index.ts` |
| Every query behind it | `worker/data/dashboard.ts` |
| The year chart | `client/components/YearChart.tsx` |
| The month drill-down | `client/components/MonthBreakdown.tsx` |
| Tiles, Coming up, cost per km | `StatTiles.tsx`, `DashboardPanels.tsx` |
| Arithmetic tests | `tests/dashboard.test.ts` (13) |
| Isolation | 3 new cases in `tests/isolation.test.ts` |

Verified rather than assumed:

- **Three tenant guards were each broken on purpose and watched to fail**, then
  restored — the `ledger_id` predicate on the monthly series, the same on the
  cost-per-km query, and the `garage_members` join on it. Each break failed
  exactly the test meant to catch it and no other, which is what makes the
  second guard non-vacuous.
- **Run against a real D1 with the owner's real monthly figures.** The running
  total came out at −RM 2,785.53, matching the Sheet's Total row exactly, and
  the August-vs-July delta at RM 1,141.85.
- 130 Coinbox tests, 85 Odometry (unchanged), isolation lint over 120 files.
  As of the fuel work (2026-09-03) that is **163 Coinbox and 93 Odometry**.

Two decisions worth knowing before changing anything here:

- **The trailing "normal" divides by three, always**, which agrees with the
  RM 0.00 rows being load-bearing: absent months count as zero rather than
  being dropped, so the divisor never becomes "months with entries".
- **Cost per km is the only cross-portal READ in Coinbox.** Two independent
  guards, both tested separately. `transactions.vehicle_id` has no foreign key
  by design, so a vehicle id can outlive the caller's access to it.

Still open on this page, and deliberately not built:

- **Ghost columns for Sep–Dec** showing what the rules already commit. The
  honest way to fill the empty half of the year; needs no new table.
- **Mobile.** The layout stacks and was reasoned through, but as with the rest
  of the portal nobody has opened it on a real phone.

## Next

**Coinbox — fuel consumption analytics.** The capture half shipped 2026-09-03;
this is the half that reads it. L/100km this month against last, beside the
cost-per-km panel that already exists. It joins `fuel_fills` to `transactions`
and so carries the same two independent guards as that panel — the `ledger_id`
predicate on the money and a `garage_members` join on the vehicle. The segment
SQL to reuse is `FUEL_SQL` in `apps/odometry/src/worker/data/fuel.ts`.

One thing to settle before building it: **month-over-month consumption is noisy
at low fill counts.** A month with two fills is one or two segments, and a
segment that straddles a month boundary belongs to neither cleanly. The honest
shape is probably a per-segment series with a trailing average rather than a
single monthly figure — worth deciding with a few months of real fills in view.

**Odometry — renewals (§4.6, §6.3).** The oldest outstanding commitment in this
repo, and half the reason the fleet portal exists: road tax and insurance.
Client-only work — all four endpoints are built and isolation-tested
(`GET /api/vehicles/:id/renewals`, `.../renewals/status`, `POST`, and
`PATCH /api/renewals/:id`).

One rule is easy to get wrong: **renewing INSERTS a new row and never updates
`expires_on` in place** (invariant 8). The active renewal per `(vehicle, type)`
is the greatest `expires_on`; superseded rows stay as the cost history the
forecast is built from. `renewalPatch` is `.strict()` and omits every date and
cost field, so re-dating a renewal is a 422 rather than a silent rewrite. A
missing renewal type is a setup prompt, not an alert.

**Coinbox — the Sheets mirror** (§7.6). Weaker than it was: the monthly totals
that were the main reason to open the Sheet are now the Home dashboard. What a
mirror would still buy is a copy readable on a phone without going through
Access, and arbitrary slicing the dashboard deliberately does not offer. Costs
a Google service account, JWT signing in the Worker, and a secret to rotate —
so weigh it against that narrower benefit before starting.

**Backup alerting.** A failed nightly run writes to the log and tells nobody.
`observability` is on so the evidence persists, but real alerting needs an
email provider (fleet spec §12). The obvious weakness of what is built.

**Off-Cloudflare backup copies.** Every backup sits in R2, in the same account
as the database. That covers deletion and corruption, not account loss.
Downloading one object a month elsewhere closes it.

**The shared `Sheet` close button.** Reviewed and deferred — see the papercut
row in the Odometry gap table above.

**Mobile.** Never verified on a real device. The layout is written for it (the
table scrolls inside its own container, the entry sheet is a bottom sheet at
narrow widths) but nobody has opened it on a phone.

## Picking this up on another machine

```bash
git clone https://github.com/hzrqftr/portals.git
cd portals
npm ci                    # not `npm install` -- the lockfile is committed
npx wrangler login        # needs a real terminal; opens a browser
npm run db:apply:local    # shared local D1, safe to re-run
npm run dev -w odometry   # http://localhost:5173
npm run dev -w coinbox    # run one at a time; both want port 5173
npm test                  # lint + 93 Odometry + 163 Coinbox tests
```

This path is verified, not assumed: it was run end to end from a scratch clone
on 2026-08-21 (clone → `npm ci` → migrations → 73 tests → build), and again
after the workspace split on 2026-08-27.

**Both portals share `.wrangler/state` at the repo root**, because they share
one D1 in production. Do not let either app create its own — a transaction
would then be unable to see the vehicle it references.

`wrangler dev` supplies a simulated Access identity through the `access.dev`
block in `wrangler.jsonc`, so local development needs no Cloudflare Access and
no login. The local database starts empty and is separate from production.

Node 24 is what this has been developed and verified on. There is no `engines`
pin, so a very different major version is untested rather than known-bad.

Deploying:

```bash
npm run deploy -w odometry   # test -> build -> migrate remote -> deploy
```

The ordering inside that script is load-bearing in two directions and is
explained in CLAUDE.md under Commands. Do not replace it with a bare
`wrangler deploy` (that is `npm run deploy:worker`, for redeploying unchanged
code) unless you are certain there is no pending migration.

### Things that will confuse you otherwise

- **Line endings are pinned to LF by `.gitattributes`.** This is not
  cosmetic. Before it existed, `core.autocrlf=true` gave a Windows clone CRLF
  while tooling wrote LF, and `scripts/check-db-imports.mjs` — which split on
  `"
"` — was left a trailing carriage return that stopped its comment
  stripping from matching, so the tenant-isolation lint reported its own
  comments as violations and a fresh clone could not run `npm test` or
  therefore `npm run deploy`. If you ever see that lint flagging prose, suspect
  line endings first.
- **`github.com` is blocked by the office wifi policy.** `git push` hangs for
  ~21 seconds and fails, while `gh` commands succeed, because those hit
  `api.github.com`. It is not a git or credential problem. Tethering to a phone
  hotspot clears it. It is network-dependent, not permanent -- the push on
  2026-08-28 went straight through.

  **Always attempt the push before mentioning any of this.** The owner may
  already be on a hotspot, or off the office network entirely, and being told
  to switch when the push would have worked is noise. Push first; raise the
  hotspot only if it actually fails.
- **`ctx.access` is not populated in production**, despite a correctly
  configured Worker-attached Access application. `auth.ts` therefore verifies
  the `Cf-Access-Jwt-Assertion` header itself, using `ACCESS_TEAM_DOMAIN` and
  `ACCESS_AUD` from `wrangler.jsonc`. Those two vars are load-bearing: rename
  the team or recreate the Access application without updating them and every
  request 401s. `ctx.access` remains the preferred path and takes over
  automatically if Cloudflare starts supplying it.
- **The Access assertion carries no display name**, so `users.display_name` is
  null in production where `ctx.access` would have filled it in.
- **Dashboard nav has been renamed.** Zero Trust is now Cloudflare One. The
  exact click paths in `setup-checklist.md` were corrected on 2026-08-20.
