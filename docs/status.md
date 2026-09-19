# Status

**What is true now:** what is deployed, what exists, what is next, what was
decided against, and the traps that are live today. The specs describe the
destination; this file describes the current position.

The dated log of how it got here -- every build, finding and decision with its
reasoning -- is **`docs/history.md`**. Search it before changing something
whose *why* is not obvious.

**Last updated:** 2026-09-20.

**Keep this file current, and keep it short.** When a change lands, update the
section it affects here and add a dated entry to the top of `docs/history.md`.
Do not append narrative to this file; that is how it grew to 1,600 lines.

---

## Start here

**Everything on `main` is deployed.** One branch is in flight:
`worktree-maintenance-schedule` -- the schedule revamp (a Schedule tab, the
maker reference, services no longer rewriting the schedule). It carries
migration **`0019_maker_intervals`**, not yet applied remotely, so a deploy of
it runs that migration first (the deploy script's order does this). See
`docs/history.md`, 2026-09-20.

| | |
|---|---|
| Last deployed code | `fcb21ff` (vehicle page Details \| Grant tabs). Both Workers carry everything on `main` |
| `fleet-portal` (Odometry) | version `5ff34dfd-1a2a-44ed-b77f-b55171581690` |
| `coinbox` | version `b88aa53b-16b6-40e7-a735-eed32c3fadf4` |
| Remote migrations | all 18 applied (`0001`-`0018`); nothing pending |
| Production schema | 26 tables (including `d1_migrations`, excluding `sqlite_%`/`_cf_%`), 6 views, 62 global part types |
| Production data, 2026-09-19 | 3 vehicles, 7 service records, 3 receipts, 3 grant files, 0 renewals, 12 fuel fills, 4,509 transactions, 9 recurring rules |
| `npm test` | isolation lint over 173 files, then 193 Coinbox + 179 Odometry tests |

**That table is a snapshot and this file ages.** These commands confirm the
whole of it in under a minute. Run them before trusting any figure above:

```bash
git status && git log --oneline -1          # clean? which commit?
npx wrangler d1 migrations list fleet --remote -c wrangler.jsonc
npx wrangler deployments list -c apps/odometry/wrangler.jsonc
npm test                                    # lint + both suites
```

If the deployed version does not match what `git log` says shipped, **the
deployed code is the truth and this file is stale.**

### Live system

| | |
|---|---|
| Repo | `hzrqftr/portals`, private, branch `main` |
| Odometry | https://fleet-portal.hazriq-fitri95.workers.dev -- household allowlist (`fleet-portal-allowlist`) |
| Coinbox | https://coinbox.hazriq-fitri95.workers.dev -- owner only (`coinbox-allowlist`) |
| Workers | `fleet-portal` (nightly backup cron `0 18 * * *`), `coinbox` (recurring cron `0 17 * * *`) |
| Database | D1 `fleet` (`e4bdd9c3-e885-42de-a709-4daf8f4a6edb`), shared by both |
| R2 | `portals-backup` (nightly export, 90 days), `portals-docs` (attached files, **not backed up**) |
| Access | team `effortless-hf95.cloudflareaccess.com`, Google IdP (not Workspace); each portal has its **own** AUD tag and must keep it |
| Backup manual | `docs/backups.md`, published at https://claude.ai/code/artifact/cd23be9a-5d58-4ae8-a732-4a927dc870dc (republish on every edit) |

**Nothing is blocked on the owner.** Every dashboard task (Access apps, AUD
tags, both R2 buckets, `wrangler login`) is done.

---

## What exists

A map, not a manual: one line per capability, with where to look. The *why* is
in the app's `CLAUDE.md`, the spec section, or `docs/history.md`.

### Odometry (`apps/odometry`, spec `docs/fleet-portal-spec.md`)

| Capability | Where / notes |
|---|---|
| Dashboard: attention list (maintenance **and** renewals), vehicle cards, stale-odometer warning, one-tap odometer | spec §8.1, §8.5; `worker/data/dashboard.ts` |
| Vehicles: add (intervals seeded by type and fuel), edit details, cars and motorbikes | §8.3; migration `0008` for bikes |
| Vehicle page: a **Details \| Grant** switcher at the top (Details on open), and **Maintenance \| Schedule \| Service history \| Renewals \| Fuel** below, pinned under the header. Both use `TabBar.tsx` | `routes/VehicleDetail.tsx` |
| Grant (geran) on each vehicle, on its own tab: chassis/engine no., registration date, colour, plus the grant file. **Owner name, IC and address are never fields** | `GrantCard.tsx`; migration `0018` |
| Maintenance: tracked parts grouped by category, overdue pinned, search. Status only -- the schedule is edited on the Schedule tab | §8.2; invariants 6-7; migrations `0005`, `0007`, `0009` |
| Schedule tab: every part that fits, owner's months/km beside the maker's, "longer than the maker" flag, reset to default, track/untrack, parts left over from a fuel change. **Branch, not deployed** | §8.2; invariant 6; migration `0019`; `ScheduleTable.tsx`, `data/schedule.ts` |
| Log a service: line items, labour as its own cost, per-item note, custom part types, confirmation of which clocks reset. **Branch:** early/late notice per line; the schedule changes only on "Change to ..." | §8.4; migrations `0006`, `0016`, `0017`; `scheduleCheck.ts` |
| Correct or delete a logged service (odometer reading and cached odometer kept in step) | migration `0014`; `tests/serviceEdit.test.ts` |
| Renewals tab: road tax and insurance cards (setup prompt when missing), renew = new row, correct words only, delete a mistaken row, history | §4.6, §6.3; invariant 8; `RenewalsPanel.tsx` |
| Files on service records, renewals and the grant: PDF/JPEG/PNG/WebP/HEIC, type sniffed from bytes, stored in `portals-docs` | migrations `0015`, `0018`; one `AttachmentRepo`, three owners |
| In-app file viewer: images and PDFs (PDF.js), zoom 50-300%, previous/next, download; modal on desktop, full screen on a phone | `components/viewer/`; see `apps/odometry/CLAUDE.md` |
| Fuel tab: per-fill L/100km, full tank to full tank (read only -- fills are entered in Coinbox) | invariant 10; migration `0013` |
| Settings: thresholds, timezone, currency, service templates | §8.7 |
| Nightly whole-database backup to R2, restore script, CSV export | `packages/core/src/worker/backup.ts`, `scripts/`, `docs/backups.md` |

### Coinbox (`apps/coinbox`, spec `docs/coinbox-spec.md`)

| Capability | Where / notes |
|---|---|
| Ledger: entry form, inline edit, delete, filters; 4,421-row Sheet history imported and reconciled | §1.1, §6 |
| Fuel entry: a fill-up transaction also writes Odometry's reading, fill and cached odometer, atomically | §7 decision 2; `tests/fuel.test.ts` |
| Recurring entries: declared rules, nightly cron posting, edit, pause, delete | §9; migration `0012` |
| Home dashboard: year chart with running total, month breakdown by category, coming up (next 30 days), staleness | §10 |
| Fuel consumption card: each vehicle's average L/100km and km/L; opens a drill-down with price per litre, trend chart and every fill | §10.5; money only behind the ledger predicate |
| Cross-portal links in each header | §7 decision 4 |

### Both

Identity through `getAuthenticatedUser()` only (verifies the Access JWT itself,
because `ctx.access` is empty in production), tenant isolation suites that are
seen to fail when a guard is removed, and the isolation lint over the whole
tree. See the root `CLAUDE.md`.

---

## Next

Ranked. The owner decides the order; this is the recommendation.

1. **Backup failure alerting.** A failed nightly run writes to the log and
   tells nobody. It needs an email provider chosen by the owner (fleet spec
   §12) -- ask before building.
2. **Backup copies outside Cloudflare.** Every backup, and every attached file,
   sits in the account it protects. Downloading one export a month (and each
   grant, once) closes it. Mostly a habit; a script could make it one command.
3. **Try both portals on a real phone.** Layouts are verified at 375px in a
   desktop browser, never on a device.
4. **Odometry gaps** (API exists and is isolation-tested; only the screen is
   missing):
   - **Vehicle delete.** `DELETE /api/vehicles/:id` archives, and nothing calls it.
   - **Baseline prompt after adding a vehicle** (§8.3). Without it a new vehicle
     starts with no odometer and no service history.
   - **Inline odometer edit, and showing the usage rate** with its confidence (§8.2).
   - **Per-vehicle service templates.** `service_templates.vehicle_id` is
     always NULL, so a car and a bike share "Minor service".
5. **The shared `Sheet` close button.** It floats in a zero-height row, so every
   caller must remember `pr-9` and render its own heading. `OdometerSheet` and
   `ServiceSheet` are clear only because their headings are short. The real fix
   is `Sheet` rendering the title, which touches five files. Reviewed and
   deferred.
6. **Coinbox year chart: ghost columns for future months**, showing what the
   recurring rules already commit. Optional; needs no new table.
7. **After the schedule revamp ships:** fill the maker columns for the Waja,
   City and RS150R from the three manuals (owner's Desktop PDFs) -- by hand on
   the Schedule tab, or a reviewed SQL file; production writes need the
   owner's go-ahead. Then decide on **Inspect vs Replace**: every manual has
   both, often on different cycles for one part (Waja brake fluid: inspect
   10k, replace 40k), and the app tracks Replace only. Deliberately left out
   of the revamp (owner, 2026-09-20).

**Deferred by design:** budgets and the cost forecast (fleet Phase 2),
multi-user invitations and roles (Phase 3), reminder emails (Phase 4).

---

## Decided against -- do not reopen as tasks

Each was weighed and closed. Reopening one is a product decision for the owner,
not a cleanup. The reasoning is in the linked place.

| Not built | Why | Where |
|---|---|---|
| Google Sheets mirror of the ledger | The Coinbox ledger view is enough; the CSV export is the way back to a Sheet | coinbox spec §7 decision 6 |
| Cost per km (Coinbox card, fleet "run rate") | Not read by the owner; the raw-odometer version silently understated. Fuel consumption kept instead | coinbox spec §10.5, fleet spec §6.5 |
| Grant owner details as fields | Would put IC numbers in every backup file and CSV, and in front of garage co-members | migration `0018`, `docs/backups.md` |
| Sharing a ledger (`ledger_members`) | Unrepresentable on purpose -- the two-axis design | root `CLAUDE.md`, invariant 2 |
| `transaction_id` on service records | Couples the two portals' write paths; only fuel crosses, deliberately | coinbox spec §7 decision 2 |
| Soft delete of transactions | Every query would need `deleted_at IS NULL`; one omission corrupts a total | `docs/history.md` |
| "What moved vs normal" dashboard panel | Built, unused, removed 2026-09-07 | coinbox spec §10.3 |
| Coinbox wordmark | The Odometry font is licensed and subset for "Odometry" only | coinbox spec §7 decision 5 |
| Changing a vehicle's type after creation | Would not re-seed parts; a control that pretended to would lie | `VehicleSheet.tsx` |
| D1 read replication | Stale reads for no benefit at this volume | root `CLAUDE.md`, invariant 9 |

---

## Traps in the current state

These are the live ones. Resolved traps are in `docs/history.md`. Permanent
ones are in the root and app `CLAUDE.md` files.

- **Two crons, and their order matters.** Coinbox posts recurring entries at
  17:00 UTC; fleet-portal backs up at 18:00 UTC, so the night's posts are in
  that night's dump. A newly deployed cron takes ~15 minutes to start firing.
  Check that before debugging silence.
- **Both apps share `.wrangler/state` at the repo root**, because they share
  one D1 in production. If either app creates its own, a Coinbox transaction
  cannot see the vehicle it references.
- **Dev ports are pinned: Coinbox 5173, Odometry 5174** (`strictPort`). The
  cross-portal header link hardcodes them, so a port already in use is a loud
  startup failure by design.
- **Browser automation: the driven tab reports `visibilityState: hidden`.** It
  runs no `requestAnimationFrame`, `IntersectionObserver` or `ResizeObserver`
  callbacks until something forces a paint (a screenshot does). PDF pages in
  the viewer stay blank and look broken; they are not. Also, ref-based clicks
  from the extension sometimes do not register; dispatching the click from a
  script does.
- **Production verification is read-only.** The session's guard blocks writing
  test data into production, and a deploy needs the owner to say "deploy".
  Prove write paths locally and in tests; check production with GETs and row
  counts.
- **`github.com` can be blocked by the office wifi.** `git push` then hangs
  about 21 s and fails while `gh` works. Always try the push first. Mention a
  hotspot only if it actually fails.

---

## Picking this up on another machine

```bash
git clone https://github.com/hzrqftr/portals.git
cd portals
npm ci                    # not `npm install` -- the lockfile is committed
npx wrangler login        # needs a real terminal; opens a browser
npm run db:apply:local    # shared local D1, safe to re-run
npm run dev -w odometry   # http://localhost:5174
npm run dev -w coinbox    # http://localhost:5173 -- both can run at once
npm test                  # lint + both suites
```

Verified end to end from a scratch clone on 2026-09-19: the local schema came
out identical to production's and the suite was green. Test counts only ever
go up; seeing **more** than the snapshot above is normal, seeing **fewer**
means something is wrong.

- **Nothing gitignored is needed.** No `.dev.vars`, no secrets. `wrangler dev`
  supplies a simulated Access identity through the `access.dev` block, so local
  development needs no login. The local database starts empty and is separate
  from production.
- **A very long checkout path breaks local D1** with a bare
  `internal error; reference = <id>`. Check the path length before debugging
  migrations.
- **Node 24** is what this is developed on; there is no `engines` pin.
- **Line endings are pinned to LF** by `.gitattributes`. With CRLF the
  isolation lint once flagged its own comments. If it ever flags prose,
  suspect line endings first.
- **Deploy with `npm run deploy -w <app>`**: test, build, migrate remote, then
  deploy. The order is load-bearing; see the root `CLAUDE.md`, Commands.
  `deploy:worker` skips all of it and is only for redeploying unchanged code.
- **The Access assertion carries no display name**, so `users.display_name` is
  null in production.
- **Zero Trust is now called Cloudflare One** in the dashboard. The click paths
  in `docs/setup-checklist.md` use the current names.
