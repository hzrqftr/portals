# Status

Where the project actually is, and what to pick up next. The specs say what to
build; this file says how much of it exists.

**Last updated:** 2026-08-28

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

## What is deliberately NOT built

**The `transactions` and `categories` schema.** It is the open design question
in the kickoff document, so it is a proposal in `docs/coinbox-spec.md` §4, with
what is still undecided in §7. A document is cheap to argue with; a migration
against financial history is not.

Only `ledgers` (migration `0010`) exists, because scope resolution and the
isolation test cannot exist without it.

**Do not implement §4.2 onward without asking the owner.** §7 lists six open
decisions, including category structure and how much of the Odometry link to
build in phase one.

## Blocked on the owner — cannot be done from a coding session

1. **A Coinbox wordmark.** Odometry's Bukhari Script woff2 is subset to its own
   eight glyphs and is licensed for personal use only, so it cannot be reused.
   Coinbox stays on body type until it has its own face. Nothing depends on it.
2. **An R2 bucket named `portals-backups`.** The backup code is BUILT and
   ships with the next deploy — this bucket is now the only thing between it
   and running. Cloudflare dashboard → R2 → Overview → Enable, then create the
   bucket. R2 has a 10 GB free tier; Cloudflare asks for billing details to
   switch it on. At roughly 300 KB/day and 90 days retention (~27 MB) it stays
   free. Until the bucket exists the nightly job logs
   "Backup skipped: no BACKUPS binding" and does nothing, which fails safe.

### Cleared on 2026-08-28

- **`wrangler login`** — done. The CLI is authorised again; `whoami` reports
  `hazriq.fitri95@gmail.com`, account `d635376dc2be247b10234d81a23a15f5`.
- **The Coinbox Access application** — created, owner-only policy
  `coinbox-allowlist`, its AUD tag now in `apps/coinbox/wrangler.jsonc`.

## Traps in the current state

- **The migration ledger is fully applied.** `0001`–`0010` are applied both
  locally and remotely as of 2026-08-28. There is no pending migration, so the
  next deploy of either portal has nothing to land. Confirm with
  `npx wrangler d1 migrations list fleet --remote -c wrangler.jsonc`.
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
| Coinbox app | https://coinbox.hazriq-fitri95.workers.dev — live, owner-only |
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
  fleet-portal exports every table as JSON to `portals-backups`, keyed
  `fleet/YYYY-MM-DD.json`, keeping 90 days. One D1 means one backup covering
  both portals. Table discovery reads `sqlite_master` rather than a hardcoded
  list, so a table added later is included without anyone remembering.

  Retention is 90 days because **D1 Time Travel was measured at 30** — not
  assumed, which both specs had asked for. The export earns its place on what
  Time Travel cannot do: outlive 30 days, survive loss of the Cloudflare
  account, and be a file you can read and move.

  `scripts/restore.mjs` is the operator path, and the round trip runs on every
  `npm test`. It was also exercised by hand: 208 rows across 15 tables wiped
  and restored, foreign key check clean.
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

Deferred by design: Budgets (§8.6) is Phase 2, multi-user is Phase 3, backups
and reminders are Phase 4.

### Coinbox

Everything except the skeleton. `GET /api/me` is the only endpoint.

| Gap | Spec | Why it matters |
|---|---|---|
| `transactions` + `categories` schema | §4.2, §4.3 | The whole app. Deliberately unwritten — see §7 open decisions |
| Entry form | §1.1 | Conditional field visibility is the main thing Google Forms cannot do |
| Sheet import | §6 | ~80 car fuel rows need a manual triage screen; motorcycle rows are unambiguous |
| ~~Backup + restore~~ | §7.6 | **BUILT 2026-08-28.** Nightly whole-database export to R2, 90-day retention, restore round trip in CI. Needs the R2 bucket created (see blocked list) |
| Cross-portal navigation | §7.4 | `AppHeader` takes a `portals` prop nothing passes. Blocked on Access groups reaching the Worker |

---

## Next

Two independent tracks. **Ask the owner which**, rather than assuming — the
workspace split was done to unblock Coinbox, but Odometry's renewals gap
predates it and is the older commitment.

**Coinbox:** settle `docs/coinbox-spec.md` §7 with the owner, then write the
transactions schema, then import the Google Sheet. Backups (§7.6) are DONE for
R2 as of 2026-08-28 and no longer gate this — that was the point of doing them
first. The Sheets mirror is still open, deliberately deferred until there are
rows worth mirroring.

The owner's stated direction: Coinbox replaces a Google Form feeding a Sheet,
reproducing that workflow and then improving on it (§1.1 — conditional fields,
editing past entries, real validation, vehicle attribution). §6 describes the
import, including the ~80 car fuel rows that need manual triage.

**Odometry — renewals (§4.6, §6.3):** road tax and insurance. Comparatively simple, and it mirrors what already
exists — with one rule that is easy to get wrong:

**Renewing inserts a new row. It never updates `expires_on` in place**
(invariant 8). The active renewal per `(vehicle, type)` is the greatest
`expires_on`; superseded rows stay as the cost history the forecast is built
from. `renewalPatch` is `.strict()` and omits every date and cost field, so an
attempt to re-date a renewal is a 422 rather than a silent rewrite.

Endpoints, all built and isolation-tested: `GET /api/vehicles/:id/renewals`,
`GET /api/vehicles/:id/renewals/status`, `POST /api/vehicles/:id/renewals`,
`PATCH /api/renewals/:id`.

A missing renewal type is a setup prompt, not an alert — the same reasoning as
a maintenance part with no baseline.

---

## Picking this up on another machine

```bash
git clone https://github.com/hzrqftr/portals.git
cd portals
npm ci                    # not `npm install` -- the lockfile is committed
npx wrangler login        # needs a real terminal; opens a browser
npm run db:apply:local    # shared local D1, safe to re-run
npm run dev -w odometry   # http://localhost:5173
npm run dev -w coinbox    # run one at a time; both want port 5173
npm test                  # lint + 73 Odometry + 7 Coinbox tests
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
