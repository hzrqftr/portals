# CLAUDE.md — Odometry

App instructions. **Read the workspace `CLAUDE.md` at the repo root first** —
it holds the stack-level invariants (money, tenant scoping, identity, SQL
aggregation, dates), the commands, and why the two portals share one repo.
This file holds only what is specific to the fleet portal.

## Project

A personal vehicle fleet portal: maintenance status, road tax and insurance
renewals, and cost forecasting for a small fleet. One Cloudflare Worker
(`fleet-portal`) serving a React SPA and a JSON API.

Full design lives in `docs/fleet-portal-spec.md`. **That spec is
authoritative.** This file lists the domain rules that are easy to break
without noticing.

## Ownership axis: the garage

Odometry scopes on `garage_id`. The indirection exists so a garage can be
shared between people in one household — `garages` + `garage_members` with
roles `owner`/`editor`/`viewer`.

`src/worker/scope.ts` resolves it. Repositories extend `GarageScopedRepo` in
`src/worker/data/base.ts`, which supplies the tenant predicate to the generic
base in `@portals/core/worker`.

**Coinbox deliberately does not reuse this.** Adding someone to a garage so
they can see service schedules must never expose their ledger. If you find
yourself wanting a `garageId` on Coinbox's scope object, that is the leak.

Deliberate exceptions to "everything filters on `garage_id`":

- `user_settings` is scoped by `user_id` — settings belong to a person, so two
  members of one garage can have different due-soon thresholds.
- `part_types` with `garage_id IS NULL` are global seed rows. Reads are
  `garage_id IS NULL OR garage_id = ?`, and uniqueness uses
  `uq_parttype_code ON part_types(COALESCE(garage_id, ''), code)`.

## Domain invariants

These are invisible when broken. The root file owns 1–5 and 9, so this file
runs 6, 7, 8, then 10 — the gap is the root’s read-replication rule, not a
missing invariant.

### 6. Due dates are derived, never stored

Compute from `last service + interval rule`. There is no "next service
mileage" column and there must never be one. If you find yourself wanting to
cache a due date, cache it in a view.

**One interval per part, and the OWNER sets it (since 2026-09-20).** The
schedule lives in exactly one place, `maintenance_intervals`, and is edited on
the vehicle's **Schedule tab** (`GET`/`PUT /api/vehicles/:id/schedule`,
`ScheduleRepo`). Logging a service does **not** change it. Each new line on
the log-service form says whether the part was replaced early or late against
the schedule (`scheduleCheck.ts`), and the schedule changes only if the owner
presses "Change to ..." there -- which is the one case the client sends
`intervalKmOverride`/`intervalMonthsOverride`, and the one case
`ServiceRepo` writes the schedule.

Before 2026-09-20 every line sent its current interval, so every service
rewrote the schedule whether anyone meant it to or not, and the owner could
not tell what the schedule was or why it had moved. **Do not reintroduce a
pre-filled interval on the service form.** An edit of a saved service never
resends one either: items are rewritten on update, so a resent figure would
silently put the schedule back to what it was at that visit.

`v_maintenance_due` computes `due_km = baseline odometer +
maintenance_intervals.interval_km`, so the API never receives a due point at
all. The test for whether something is a due date: correct the service
odometer, and see whether the number moves. It must.

**`maker_intervals` (migration 0019) is a reference, not a schedule.** It holds
the manufacturer's figure beside the owner's, so the Schedule tab can flag an
interval LONGER than the maker recommends. No view reads it and nothing is
ever due from it. It is its own table because `maintenance_intervals`' CHECK
needs an interval of the owner's, and an untracked part can still have a
known maker figure. It is never seeded from `part_type_defaults` -- those are
generic figures, and a delta against an invented maker number is worse than
none.

**That test is now executable, and runs.** A service can be corrected after the
fact (migration `0014`), and `tests/serviceEdit.test.ts` asserts exactly this:
edit the odometer of a logged visit and the due point moves with it. Correcting
the odometer also corrects the `odometer_readings` row the visit wrote and
rebuilds the vehicle's cached figure -- three copies of one number, kept in step
by `service_records.odometer_reading_id` and the helpers in
`packages/core/src/worker/odometer.ts`.

One consequence looks like a bug and is not: **removing a line item does not
revert the vehicle's interval** when that visit changed it. Nothing stores
what the schedule was before, so there is no previous value to restore. The
Schedule tab is where an interval is changed back.

**`service_items.interval_km_override` is history, not a schedule.** It
records that this visit changed the schedule, and to what (older visits, from
before 2026-09-20, carry one on every tracked part). Nothing computes from it
— the view does not join it. Do not reintroduce it into the due-point
calculation.

Migration 0004 made it a genuine override that outranked the vehicle's setting
for one cycle, to support "come back in 5,000 this time, then back to normal".
It was removed in 0005 because two numbers for one part could not be explained
on screen: editing the interval to 6,000 left the schedule reading 5,000, and
the save looked like it had silently failed. If per-cycle scheduling is ever
wanted again, it needs a UI that shows both numbers and says which is in charge
— not a silent `COALESCE`.

**Which parts a vehicle STARTS with, and at what interval, comes from
`part_type_defaults`** — keyed by `(part_type_id, vehicle_type)` and copied
into `maintenance_intervals` when the vehicle is added; the Schedule tab lists
every part with a row for the vehicle's type (fuel filtered live) and offers
the default as "reset". A part with no row for a vehicle type does not apply
to it at all: a motorbike is never offered a cabin filter, and `PUT
/schedule` refuses one. `vehicleType` cannot be PATCHed for the same reason. Intervals live there rather than on `part_types`
because they differ by type — engine oil is 10,000 km on a car and 3,000 on a
bike — and duplicating the part type would split the brand history and service
records for one real-world thing.

`seed_by_default` is separate from the intervals on purpose. "Not seeded" used
to be encoded as both intervals being NULL, which left opt-in parts with no
number to offer once the owner did tick them. Do not re-conflate them.

### 7. A `service_item` resets the maintenance clock, not the `service_record`

A service visit with no line items resets nothing. The baseline for any part
type is the most recent `service_item` of that type.

`service_records.service_type` ("minor", "major", …) is a **label and a
template key**, never a clock. It pre-fills the parts list in the log-service
form and is used for filtering and cost breakdown. A "major" saved with no line
items resets nothing, exactly like an untyped one.

### 8. Renewals are immutable

Renewing road tax or insurance **inserts a new row**. Never update `expires_on`
in place — cost history drives the forecast. The active renewal per
`(vehicle, type)` is the greatest `expires_on`.

**Deleting is allowed, for a row entered by mistake (added 2026-09-19).**
Because "active" is simply the greatest `expires_on`, a mistyped LATER expiry
would otherwise stay active forever and hide every real renewal. Removing a row
that never happened is not the same as re-dating one that did, and the UI
labels it that way. `PATCH` still refuses dates and cost.

### 10. Consumption is measured full tank to full tank

`fuel_fills` (migration `0013`) records litres and `is_full_tank`. A segment
runs from one full fill to the next, and the litres attributed to it are ALL the
litres bought in between — **partial fills included**, because that fuel was
burned over that distance too.

Dropping a partial fill understates consumption; dividing one by its own
distance overstates it. Both produce a number in an entirely plausible range
with nothing on screen able to say so, which is why `is_full_tank` is NOT NULL:
"we do not know" and "it was full" must never be the same stored value.

**Fills are created from Coinbox, not here.** The litres and the ringgit are
keyed in together at the pump, and splitting them across two apps is how
odometer logging stops. This portal has `GET /api/vehicles/:id/fuel` and no
POST beside it.

**No money appears on the fuel page.** `fuel_fills` is garage-scoped and a
garage is shared, so a price there would be readable by every co-member. The
ringgit lives in Coinbox behind the ledger predicate.

**The fill points at its odometer reading rather than copying it.** Unlike
`service_records`, which carries its own `odometer_km` alongside a
`source='service'` reading. Two copies of one number are two numbers that can
disagree. A consequence: fills use `source='manual'`, because "which readings
came from a fill" is a join, and widening the `CHECK` would have cost a 12-step
table rebuild for nothing.

## The odometer write lives in `@portals/core`

`packages/core/src/worker/odometer.ts` owns the backwards check and the
insert-plus-guarded-cache-update pair. It was copy-pasted in `vehicles.ts` and
`services.ts`; Coinbox's fuel entry would have made a third copy of a rule that
is invisible when broken.

It RETURNS statements rather than running them, so each caller folds them into
its own `batch()`. That is not a style choice — Coinbox has to write a
transaction, a reading and a fill atomically.

## Files: receipts, renewal documents, the grant

Three tables, one per parent: `service_attachments` (migration 0015),
`renewal_attachments` and `vehicle_documents` (0018, `kind = 'grant'`). The
files are in the R2 bucket `portals-docs`, bound as `DOCS`. One
`AttachmentRepo` serves all three, configured by `SERVICE_RECEIPTS`,
`RENEWAL_DOCUMENTS` or `VEHICLE_GRANT` in `src/worker/data/attachments.ts` --
add an owner there rather than copying the class, because the rules below are
exactly what a copy drifts on. The portal-agnostic half -- size limit, type
sniffing, key naming, R2 calls -- is `packages/core/src/worker/attachments.ts`,
so Coinbox can reuse it. The tables are not shared with Coinbox: it scopes on
`ledger_id` and a shared table would need a nullable tenant column.

**The grant's owner details are never columns.** Chassis no. (`vin`), engine
no., registration date and colour are; the registered owner's name, IC number
and address stay inside the PDF (owner decision, 2026-09-19). Columns go into
the nightly backup JSON and the CSV export, and a garage is shared.
`tests/renewals.test.ts` fails if a column with one of those names appears.

Three rules that are invisible when broken:

- **The stored content type comes from the file's leading bytes, never from the
  request.** This Worker serves the SPA and the API on one origin, so a file
  uploaded as `image/png` whose bytes are markup executes on the portal's own
  origin when served back. The download route pairs the sniffed type with
  `nosniff`. Do not "simplify" by trusting `file.type`.
- **R2 objects do not cascade; rows do.** `ServiceRepo.remove()` and
  `RenewalRepo.remove()` read the keys BEFORE the delete and clear the bucket
  after. Any new path that deletes a parent has to do the same, and the
  database looks correct either way -- `tests/attachments.test.ts` and
  `tests/renewals.test.ts` are what notice. (Vehicles are archived, never
  deleted, so grant files have no such path today.)
- **`Env.DOCS` is required, unlike `Env.BACKUPS`.** A backup that skips a
  missing binding is a no-op; an upload that skips one reports success for a
  file it never stored.

These files are outside both backup nets. See `docs/backups.md`.

### The in-app viewer (`src/client/components/viewer/`)

Every file in `Attachments` -- saved or still pending in a form -- opens in
`FileViewer`: images, and PDFs drawn by **PDF.js** (owner decision,
2026-09-19; the browser's own viewer shows nothing inside a page on Android).
It is a centred modal on a desktop and full screen on a phone, with zoom from
50% to 300% around "fit" (`-` / `+` / `0` on the keyboard). Three rules that
are invisible when broken:

- **Canvas only for PDFs.** No text layer, no annotation layer, so nothing in an
  uploaded PDF can become a link or a form on this origin. PDF.js is the legacy
  build (old iPhones), lazily imported, with its worker as a separate asset.
- **It must not close the Sheet underneath it.** Escape is stopped in a
  capture-phase `window` listener, and clicks are stopped at the viewer's root
  because React bubbles portal events to the React parent -- the Sheet's scrim.
- **It only undoes a page lock it applied.** Inside a Sheet the Sheet owns
  the lock; restoring a recorded lock once froze the page after the Sheet
  closed first. Found in testing.

Test it with the tab visible: a hidden tab runs no `IntersectionObserver` or
`ResizeObserver` callbacks, so PDF pages stay blank and look broken.

## Domain traps

- **Odometer readings can be entered out of order.** Discard readings that
  decrease relative to an earlier date rather than producing negative usage
  rates.
- **A vehicle with no service history is `unknown`, not `overdue`.** Never
  alert on items that have no baseline.
- **Any table rebuild must drop and recreate dependent views.** Migrations 0007
  and 0008 both drop `v_maintenance_due` and `v_part_baseline` and recreate
  them; follow that pattern.

## Style

Desktop-first does not mean desktop-only. The quick odometer flow (spec 8.5)
happens at a petrol pump, so its controls stay full-width thumb targets at
every breakpoint.

The `font-wordmark` face is a woff2 **subset to the eight glyphs in
"Odometry"** — see the note in `src/client/index.css` before applying it to any
other text, which would silently fall back mid-word. `fonts-src/README.md` has
the regeneration command and the licence note (personal use only).
