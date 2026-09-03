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

**One interval per part, and the last service sets it.** The schedule lives in
exactly one place, `maintenance_intervals`. A service that specifies an
interval writes it there, so "the interval keyed in at the last service" and
"the vehicle's interval" are the same fact, not two facts that can disagree.

`v_maintenance_due` computes `due_km = baseline odometer +
maintenance_intervals.interval_km`. The user types an absolute figure because
that is what the workshop sticker says; the client subtracts the service
odometer before sending, so the API never receives a due point at all. The test
for whether something is a due date: correct the service odometer, and see
whether the number moves. It must.

**`service_items.interval_km_override` is history, not a schedule.** It records
what the interval was at that service. Nothing computes from it — the view does
not join it. Do not reintroduce it into the due-point calculation.

Migration 0004 made it a genuine override that outranked the vehicle's setting
for one cycle, to support "come back in 5,000 this time, then back to normal".
It was removed in 0005 because two numbers for one part could not be explained
on screen: editing the interval to 6,000 left the schedule reading 5,000, and
the save looked like it had silently failed. If per-cycle scheduling is ever
wanted again, it needs a UI that shows both numbers and says which is in charge
— not a silent `COALESCE`.

**Which parts a vehicle has, and at what interval, comes from
`part_type_defaults`** — keyed by `(part_type_id, vehicle_type)`. A part with no
row for a vehicle type does not apply to it at all: a motorbike is never
offered a cabin filter. Intervals live there rather than on `part_types`
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
