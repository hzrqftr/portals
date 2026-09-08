# Status

Where the project actually is, and what to pick up next. The specs say what to
build; this file says how much of it exists.

**Last updated:** 2026-09-08 (the fuel drill-down, deployed)

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

## The fuel drill-down — 2026-09-08, DEPLOYED

Each row of Coinbox's cost-per-kilometre card now opens a sheet: consumption
per tank with a trailing mean, price per litre, the 12-month spend split, the
distance behind it, and every fill in a table. **No migration** -- it reads only
data `0013` already captures.

This closes the "fuel consumption analytics" item that stood at the top of
*Next*, and reopens `docs/coinbox-spec.md` §10.3's "Consumption trend, for now"
deliberately. Both of that deferral's reasons survived and shaped the result:
the series is young, so the chart shows **all fills** rather than a 12-month
window, and month-over-month was rejected for the **per-segment series with a
trailing average** §10.3 itself guessed at.

| Piece | Where |
|---|---|
| The segment SQL, now shared | `packages/core/src/worker/fuel.ts` |
| The weighted average, isomorphic | `packages/core/src/fuel.ts` |
| The guarded read | `apps/coinbox/src/worker/data/vehicleFuel.ts` |
| `GET /api/vehicles/:id/fuel` | `apps/coinbox/src/worker/routes/index.ts` |
| The sheet and the chart | `client/components/VehicleFuelSheet.tsx`, `ConsumptionChart.tsx` |
| Arithmetic tests | `apps/coinbox/tests/vehicle-fuel.test.ts` (10) |
| Isolation | 2 new cases, plus the per-vehicle path in all four sweeps |

Five decisions worth not re-litigating:

- **`FUEL_SQL` moved to `packages/core` rather than being copied.** It cost
  almost nothing: Coinbox's `assertUsableVehicle()` already returns the garage
  id off the vehicle row, so both portals bind the same `(vehicleId, garageId)`
  pair and only the proof of entitlement differs. Two copies of segment
  arithmetic would have kept returning plausible numbers while drifting, with
  nothing on either screen able to say which was right.
- **This is the portal's SECOND cross-portal read, and the sharper one.**
  `fuel_fills` is garage-scoped, so a co-member is *entitled* to the litres --
  Odometry already shows them. What they must never get is the ringgit. So it
  is the one endpoint where the two halves of one physical event are served
  together and have to come apart along the tenant boundary. The money
  predicate lives in the JOIN's `ON` clause, not a `WHERE`: in a `WHERE` it
  becomes an inner join and hides a co-member's fills entirely rather than
  merely unpricing them.
- **The average is DISTANCE-WEIGHTED, and Odometry was corrected to match.**
  `FuelHistory.tsx` took the plain mean of the per-segment rates, which counts
  a 40 km top-up as heavily as a 600 km run. Both portals now call
  `weightedLPer100km` in `@portals/core`. On the local data the two figures
  differ by 0.006 L/100km -- which is exactly why this had to be caught by a
  test rather than by eye.
- **Two cost-per-km figures appear in the sheet on purpose.** The card's is
  12 months of fuel *and servicing*; the sheet's own is fuel only over closed
  segments, all time. Each is labelled, and the card's is **not recomputed** --
  it is passed in as the row that was clicked, so they cannot disagree even in
  principle. The spend breakdown *does* reconcile with it, by construction and
  by test.
- **Price per litre is its own plot, not a second y-axis.** Different units on
  one pair of axes can be scaled to agree or diverge at will. They share the x
  bands so points align and one hover lights both.

Verified rather than assumed:

- **All three tenant guards were broken on purpose and watched to fail**, then
  restored -- the membership check (Bob read a stranger's fills), the ledger
  predicate on the fills join (Carol saw RM 999.99), and the ledger predicate
  on the spend breakdown. Each failed exactly the test meant to catch it.
- **The weighted average was broken on purpose too**, and its test failed with
  9.0 against the expected 8.18 -- the unweighted answer, in the plausible range.
- **Run against the real local database, not just tests.** Six fills seeded on
  the City including one part fill: the part fill's 16.6 L correctly carried
  into the segment that closed at 8.17 L/100km, and the card and the sheet
  reported identical spend for all three vehicles (RM 3,024.27 / 1,667.75 /
  694.00). Odometry's Fuel tab and Coinbox now both print 7.89675 for the City.
- Odometry's 107 tests pass **with `apps/odometry/tests/fuel.test.ts`
  unedited**, which is what proves the extraction changed no behaviour.

### Deployed 2026-09-08

| Worker | Version | Notes |
|---|---|---|
| `coinbox` | `ec30c0f9-96ea-4c84-b51e-6876673b10b3` | the drill-down |
| `fleet-portal` | `96ef56e6-0f3c-4528-99a3-544531f5d827` | shared segment SQL, corrected average |

`main` fast-forwarded to `96f576a`, no merge commit. **No migration** --
`wrangler d1 migrations list --remote` reported nothing to apply both before
and during each deploy, and production row counts were identical either side:
3 vehicles, 4,458 transactions, 5 fuel fills, 9 odometer readings, 25 tables.
Both crons survived (`0 17 * * *` on coinbox, `0 18 * * *` on fleet-portal) and
both portals still 302 to Access, `/api/*` included.

**Production already holds 5 real fills**, so the drill-down has live data on
day one rather than an empty state.

Both portals were deployed because `packages/core` changed. That is exactly why
the deploy script runs the WHOLE workspace's tests rather than one app's.

**STILL NOT SEEN IN A BROWSER.** The Chrome extension was not connected in the
session that built and shipped this, so the layout, the 375px behaviour and the
hover readout have been reasoned about but never observed -- on local or on
production. Deployed anyway at the owner's instruction. **First thing to check:
open the dashboard and click a vehicle.** The likeliest faults are cosmetic and
in the sheet: heading collision with the close button, the chart's y-axis
labels at narrow widths, and the stacked bar when one slice rounds to under a
pixel.

One transient worth knowing: the first `wrangler d1 migrations list --remote`
failed with `7403 The given account is not valid or is not authorized`, while
`d1 list` and `deployments list` both succeeded on the same credentials. A
plain retry worked. Check twice before believing wrangler has lost its login.

### Both dev servers really can run at once now -- 2026-09-08

This file has claimed that since 2026-09-05 and it was **half true**. The HTTP
ports were pinned, but the Cloudflare vite plugin's **Node inspector port**
defaulted to 9229 in both apps, so the second to start died with
`EADDRINUSE: 127.0.0.1:9229` -- an error naming a port neither config mentioned,
while the two ports that *were* configured looked perfectly correct.
`inspectorPort` is now pinned alongside the HTTP port: **Coinbox 9229,
Odometry 9230**. Started from clean, both now come up together.

## Both portals deployed — 2026-09-05

| Worker | Version | Notes |
|---|---|---|
| `fleet-portal` | `986df042-fb5f-47f3-8695-c5492a76e0f5` | carries migration `0014` |
| `coinbox` | `0f219eef-5e03-4139-93fb-56b2c2703d1a` | header link only, no migration |

Migration `0014` applied remotely, and checked rather than assumed. Row counts
identical before and after (3 services, 1 item, 7 readings, 3 vehicles, 4,451
transactions, 25 tables); **all 3 production services linked to their reading,
none orphaned**; `PRAGMA foreign_key_check` clean. The backfill match was
previewed as a read-only SELECT first and showed exactly one candidate reading
per service — no ambiguity to resolve.

Both crons survived (`0 18 * * *` on fleet-portal, `0 17 * * *` on coinbox) and
both portals still 302 to Access, `/api/*` included.

## A service can be corrected — 2026-09-05

`PATCH /api/services/:id` existed but `servicePatch` omitted `items`,
`odometerKm` and `servicedOn`, so a visit logged with the wrong odometer could
never be fixed — only deleted and re-logged. The owner hit exactly that.

Those three were closed rather than wrong. **The service odometer lives in
three places** — `service_records.odometer_km`, the `odometer_readings` row the
visit writes, and the cached `vehicles.current_odometer_km` — and nothing
linked the service to the reading it created, so a correction could only ever
update one of the three and leave the others asserting the original figure.

Migration `0014` adds `service_records.odometer_reading_id`, shaped after
`fuel_fills.odometer_reading_id`, and backfills it by matching on what the
create path wrote. Production holds no service records, so remotely it is a
column add and nothing else.

| Piece | Where |
|---|---|
| The link | `migrations/0014_service_odometer_reading.sql` |
| Correct a reading, rebuild the cache | `packages/core/src/worker/odometer.ts` |
| Replacement semantics | `serviceUpdate` in `apps/odometry/src/shared/zod/` |
| `update()` and a fixed `remove()` | `apps/odometry/src/worker/data/services.ts` |
| Log-or-edit form | `client/components/ServiceSheet.tsx`, `serviceDraft.ts` |
| Tests | `tests/serviceEdit.test.ts` (10) |

Four decisions worth not re-litigating:

- **An edit is a REPLACEMENT, not a merge.** `items` is a set, and a partial
  merge over a set cannot express removing a line. Once items go whole,
  everything going whole is one rule rather than two. Consequence: an omitted
  optional CLEARS, and a partial body is now a 422.
- **The cached odometer is REBUILT, not nudged.** `odometerWriteStatements`
  only ever moves that figure forward in time, which is right for an append and
  wrong for a correction — 112,000 keyed for 12,000 would otherwise leave the
  dashboard on 112,000 permanently. `recacheOdometerStatement` recomputes from
  the readings. Its `COALESCE(..., 0)` is load-bearing:
  `current_odometer_km` is `NOT NULL DEFAULT 0`, and without it deleting the
  last service is a 500.
- **Removing a line item does NOT revert the vehicle's interval.** Invariant 6:
  the last service sets the schedule and nothing stores what it was before, so
  there is no previous value to restore. Pinned by a test so nobody "fixes" it
  by inventing one. The save confirmation says so on screen.
- **`remove()` had the same latent bug and is fixed too.** Deleting a service
  used to leave its reading behind, propping the vehicle's odometer up with a
  visit that no longer existed.

Verified rather than assumed:

- **The tenant guard was broken on purpose and watched to fail.** Removing the
  garage predicate from `update()`'s load alone changes nothing observable —
  the per-statement predicates catch it, and `list()` re-scopes when building
  the response. Removing **both** lets A rewrite B's service, and the isolation
  suite fails with `expected 'hijacked' to be 'BOB_WORKSHOP'`. That assertion
  is new: the 404 alone never proved the edit was refused, because the tail
  re-read would 404 even after a successful write.
- **Run against the real local database, not just tests.** The City's service
  was PATCHed with its own values and came back byte-identical, same reading
  id, still one reading. The RS150R was corrected 91,250 → 91,500: the record,
  its reading and the cache all moved, spark plugs went 101,250 → 101,500, and
  correcting it back restored every figure. Three edits, still one reading —
  never duplicated. `PRAGMA foreign_key_check` clean.

## The two portals link to each other — 2026-09-05

`AppHeader` has always accepted a `portals` prop and rendered it; nothing
passed it. Each header now does. **The bet that deferring this would cost an
array rather than a rework paid off exactly as written** — no chrome was
reworked in either app.

What was deferred was never the link but the **filtering**. Odometry admits the
household, Coinbox admits the owner alone, so a co-member following Odometry's
link reaches a Cloudflare denial page. Shown anyway, deliberately: the owner is
the only person with both, and a hypothetical co-member's dead link costs less
than no navigation for the person who actually uses both. The clean fix remains
Access groups, still blocked on a groups claim that does not reach the Worker.
**Do not substitute an email allowlist in `wrangler.jsonc`** — it duplicates the
Access policy somewhere nobody looks, and the copy that drifts is that one.

The URLs are hardcoded per app with a dev branch, which is why the dev ports are
now pinned with `strictPort` (Coinbox 5173, Odometry 5174). Both dev servers can
run at once, and a port collision now fails loudly instead of moving silently.

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
- ~~**Both dev servers want port 5173.**~~ **FIXED 2026-09-05.** The ports are
  pinned with `strictPort`: **Coinbox 5173, Odometry 5174**, and both can run
  at once. They had to become deterministic because the cross-portal header
  link hardcodes the sibling's dev address -- a port that drifts would make
  that link wrong rather than merely inconvenient. `strictPort` means a port
  already in use is now a loud startup failure instead of a silent move to the
  next one.
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

Data currently in production, **measured 2026-09-05, not assumed**: one user,
one garage, three vehicles (Waja and City, both `vehicle_type = 'car'`, and an
RS150R, `'motorcycle'`), 96 maintenance intervals, **3 service records, 1
service item, 7 odometer readings** and 4,451 transactions. 25 tables.

This paragraph previously said production had no readings, no service history
and no renewals. **That was true when written on 2026-08-28 and quietly stopped
being true as the portal got used** — it was caught only because the `0014`
pre-flight counted rows rather than trusting this file. Count before believing
any figure here; it is the kind of line that ages without anyone editing it.

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
| Inline odometer edit, usage rate | §8.2 | The Details panel now shows the spec, but the odometer can only be changed from the dashboard (or now by correcting the service that recorded it), and the usage rate with its confidence indicator is not surfaced anywhere |
| ~~Editing a service after saving~~ | §8.4 | **BUILT 2026-09-05**, migration `0014`. See below |
| Custom part types in the UI | — | `POST /api/part-types` exists and is isolation-tested, but nothing calls it yet; the 61 seeded types cover the common cases |
| Per-vehicle service templates | §8.4 | `service_templates.vehicle_id` exists and is always NULL; templates are garage-wide for now, which also means one "Minor service" template is shared between a car and a bike |
| Changing a vehicle's type | — | Read-only once created, deliberately: switching it would not re-seed or un-seed anything, so a control that appeared to turn a car into a bike while leaving forty car parts behind would be lying. Delete-and-recreate for now |
| `Sheet`'s close button (both portals) | — | `packages/core/src/client/Sheet.tsx` floats its X in a zero-height row, so every caller must remember `pr-9` to stay clear of it, and must render its own `<h2>` because `title` is only an aria-label. Three of five callers remember; **`OdometerSheet` and `ServiceSheet` are correct only because their headings are short** — a longer vehicle nickname reproduces the collision Coinbox hit on 2026-08-28, and `ServiceSheet`'s heading grew by two characters on 2026-09-05 ("Edit service — " vs "Log service — "), which narrows that margin without closing it. Reviewed and deliberately deferred: the real fix is `Sheet` rendering the title itself, which touches five files and needs judgement in `ServiceSheet` (its saved-state screen) and `PartDetailSheet` (its pill header) |

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
| ~~Recurring entries~~ | §9 | **BUILT 2026-08-30**, delete wired into the page **2026-09-07**. Declared rules, nightly cron, edit, pause, delete. See below |
| The Sheets mirror | §7.6 | Still open. A readable copy on a phone without the app; needs a Google service account and JWT signing in the Worker |
| Backup failure alerting | — | A failed nightly run writes to the log and tells nobody. Needs an email provider |
| Off-Cloudflare backup copies | — | Every backup is in the account it protects. One downloaded file a month closes it |
| ~~Home dashboard~~ | §10 | **BUILT AND DEPLOYED 2026-08-31.** The surplus/deficit table as a chart, a month drill-down, and cost per km. See below |
| ~~Cross-portal navigation~~ | §7.4 | **BUILT 2026-09-05.** Each header links to the other portal. Shown unconditionally -- see below |
| ~~Fuel consumption analytics~~ | §10.5 | **BUILT AND DEPLOYED 2026-09-08**, a drill-down off the cost-per-km card. No migration. Not yet seen in a browser |

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

### Deleting a rule reached the page on 2026-09-07

**Deployed 2026-09-07**, Worker version `145bd442-89f3-4ef4-82fa-a348ed346de5`,
`main` fast-forwarded to `9be2459`. No migration, and
`wrangler d1 migrations list --remote` reported nothing to apply both before and
during the deploy.

The server half had been built and tested since 2026-08-30 — the endpoint, the
ledger-scoped `remove()`, the cross-tenant refusal, and the test proving posted
entries survive their rule. `useDeleteRecurring()` existed too. **Nothing
called it**, so until now the only way to remove a rule was a raw HTTP request.
This was a client-only change.

Two things the browser found that reading the code did not:

- **The trash button broke the card at 375px.** It squeezed the rule title from
  112px to 76px, cutting a long name to one word and wrapping its schedule over
  three lines. The row is `flex-wrap`, but the title carried `min-w-0`, so it
  collapsed rather than forcing the buttons onto a second line. A
  `min-w-[8rem]` floor makes it wrap; the title now gets 190px, better than
  before the change. It looked correct on desktop and broke only where entry
  actually happens.
- **Only the title opened the editor.** The amount, the next-due date, the
  posted-count line and any dead space did nothing. The card now uses the same
  stretched-overlay pattern as Odometry's vehicle tiles, with Pause and delete
  raised on `z-10` so they keep their own hit areas.

### Editing a running rule was impossible — found and fixed 2026-09-07

The owner tried to move Astro from the 30th to the 8th and got **"A recurring
entry cannot start in the past"**, an error naming a field he had not touched.

`update()` ran the forward-only check on any `startsOn` present in the patch,
and `RecurringSheet` resends the whole draft on save. A rule that has been
running has a start date in the past **by definition**, so the guard rejected
its own unchanged value. **Every rule became uneditable the day after it
started** — all nine in production. It had been that way since recurring
shipped on 2026-08-30, and nothing caught it because forward-only had no test
at all.

The guard now fires only when `startsOn` actually moves, which is the only case
that is a backdate. `tests/recurring-rules.test.ts` covers both halves —
the edit that must pass, and the backdate that must still fail — and the
regression test was seen to fail before the fix.

**The lesson worth keeping:** a validation written for *create* was reused on
*update*, where the same rule means something different. Anything that
validates "not in the past" needs to know whether it is judging a new value or
re-reading an old one.

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
  As of the fuel work (2026-09-03) that is 163 Coinbox and 93 Odometry, and as
  of service editing (2026-09-05) **163 Coinbox and 103 Odometry**.

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

**Coinbox — `vehicleCosts` divides by RAW odometer readings.** Every km figure
in Odometry reads `v_odometer_clean`, which drops readings that run backwards;
the cost-per-km card does not, and as of 2026-09-08 the fuel drill-down follows
it deliberately so the two agree on screen. A single mistyped high reading
therefore inflates `MAX − MIN` and silently understates RM/km in both places,
with nothing able to contradict it. Switching to the view would move figures the
owner already reads, so it needs a before/after count against real data rather
than a one-line change.

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
npm run dev -w odometry   # http://localhost:5174
npm run dev -w coinbox    # http://localhost:5173 -- both can run at once
npm test                  # lint + 103 Odometry + 163 Coinbox tests
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
