# Vehicle Fleet Portal — Technical Specification

**Version:** 2.0 (Cloudflare stack)
**Status:** Draft for implementation
**Supersedes:** v1.0 (GitHub Pages + Supabase)
**Target:** Personal, multi-tenant-capable vehicle maintenance and cost tracking portal

---

## 1. Overview

A web portal for tracking maintenance status, statutory renewals, and running costs across a small fleet of personally owned vehicles. Built multi-tenant from day one so it can serve additional users without a schema migration.

### 1.1 Primary goals

1. Answer "what needs attention?" in under five seconds of opening the app.
2. Minimise data entry. The only routinely-typed value should be the current odometer reading.
3. Track statutory renewals alongside mechanical maintenance in one unified timeline.
4. Forecast upcoming costs and compute true cost of ownership per vehicle.

### 1.2 Non-goals (v1)

Fuel and economy logging, trip tracking, OBD-II integration, multi-currency conversion, native mobile apps, public or unauthenticated views of any kind, open self-service signup.

### 1.3 Core design principles

**Derive, don't store.** Due dates and due mileages are computed from `last service + interval rule`, never entered by hand.

**Aggregate in SQL, not JavaScript.** Workers have a hard CPU ceiling. Every cost rollup and status computation runs as a SQL query or view, never as a JS loop over fetched rows. See §11.4.

**Isolate the identity layer.** All authentication flows through a single `getAuthenticatedUser()` function. Nothing else in the codebase knows how identity is established. See §11.1.

---

## 2. Architecture

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Cloudflare Workers | Single Worker serves assets + API |
| Static assets | Workers Static Assets | Pages is deprecated in favour of this |
| Frontend | React 18 + TypeScript + Vite | SPA |
| Vite integration | `@cloudflare/vite-plugin` | Unified dev and build |
| API routing | Hono | Lightweight, Workers-native |
| Styling | Tailwind CSS | Mobile-first |
| Client data | TanStack Query | Cache and optimistic updates |
| Database | Cloudflare D1 (SQLite) | Bound to the Worker |
| Query layer | Drizzle ORM | Typed schema, migrations, tenant scoping |
| Validation | Zod | Shared between client forms and API handlers |
| Charts | Recharts | Forecast and run-rate views |
| Auth | Cloudflare Access, Google IdP | Allowlist, edge-enforced |
| Scheduled jobs | Workers Cron Triggers | Reminders, backups |
| File storage | R2 | Invoices and documents (Phase 4) |
| Deploy | Wrangler + GitHub Actions | Push to `main` deploys |

### 2.1 Worker configuration

```jsonc
{
  "name": "fleet-portal",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-08-20",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "fleet", "database_id": "<id>" }
  ]
}
```

`not_found_handling: "single-page-application"` gives client-side routing with no 404 workarounds. `run_worker_first` sends `/api/*` to Hono before the asset handler sees it.

### 2.2 Authentication

Cloudflare Access is enabled at the **Worker level**, which protects the `workers.dev` hostname, any future custom domain, and all preview URLs simultaneously. No custom domain is required.

Authentication is enforced at the edge, before any request reaches application code:

```ts
const identity = await ctx.access.getIdentity();
// → { email, name, groups, ... }
```

No JWKS fetching, no JWT validation, no session storage, no OAuth callback handling.

**Identity provider:** use the **Google** integration (consumer Gmail accounts), not **Google Workspace**, unless every user is on a Workspace domain you control. Family members on personal Gmail will fail against a Workspace-scoped IdP.

**Allowlist management:** Zero Trust dashboard → Access → Applications → policy → Include → Emails.

### 2.3 Local development

**Access does not run in `wrangler dev`.** `ctx.access.getIdentity()` returns nothing locally. Implement a dev-only shim:

```ts
export async function getAuthenticatedUser(ctx, env): Promise<AuthUser> {
  if (env.ENVIRONMENT === "development") {
    return { email: env.DEV_USER_EMAIL, name: "Dev User" };
  }
  const identity = await ctx.access.getIdentity();
  if (!identity?.email) throw new UnauthorizedError();
  return { email: identity.email, name: identity.name };
}
```

This function is the **only** place in the codebase that touches Access. Guard the dev branch on an explicit environment variable never set in production, and add a CI assertion that the deployed config does not set `ENVIRONMENT=development`.

### 2.4 Secrets

Auth requires no secrets and there is no public frontend key of any kind, which is a meaningful simplification over the Supabase design. Later phases need an email provider key via `wrangler secret put`, never committed.

---

## 3. Tenancy model

Ownership is indirected through a **garage** rather than a user, so sharing later is a row insert rather than a migration.

**Bootstrap:** on each request, look up `users` by the Access-supplied email. If absent, create user, personal garage, and owner membership in one transaction. Idempotent, and cheap via an indexed email lookup.

**Roles:** `owner` (full control including membership), `editor` (CRUD on vehicles and records), `viewer` (read only).

**Identity key is email.** Access supplies a verified email, not a stable opaque ID. A user who changes email becomes a new user. Acceptable at this scale, but document it.

---

## 4. Data model (SQLite / D1)

### 4.1 Type conventions

These differ from the v1 Postgres spec and are not optional.

| Concern | Convention | Rationale |
|---|---|---|
| Primary keys | `TEXT`, `crypto.randomUUID()` in the Worker | No native uuid type |
| **Money** | **`INTEGER`, minor units (sen/cents)** | **SQLite has no decimal type. Floats will silently corrupt cost totals.** |
| Enums | `TEXT` + `CHECK (col IN (...))` | No native enum |
| Timestamps | `TEXT`, ISO 8601 UTC | Sorts correctly lexically |
| Calendar dates | `TEXT`, `YYYY-MM-DD`, no time | Expiries and service dates are calendar dates, not instants. See §11.5 |
| Booleans | `INTEGER` 0/1 | No native boolean |
| Distances | `INTEGER` kilometres | Whole km is sufficient |

Enable `PRAGMA foreign_keys = ON`; D1 does not enforce foreign keys by default in all contexts.

### 4.2 Identity and tenancy

```sql
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  created_at   TEXT NOT NULL
);

CREATE TABLE garages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT 'My Garage',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE garage_members (
  garage_id TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (garage_id, user_id)
);

CREATE TABLE user_settings (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  distance_unit TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km','mi')),
  currency      TEXT NOT NULL DEFAULT 'MYR',
  date_format   TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  due_soon_days INTEGER NOT NULL DEFAULT 30,
  due_soon_km   INTEGER NOT NULL DEFAULT 1000
);
```

### 4.3 Reference data

```sql
CREATE TABLE part_types (
  id                      TEXT PRIMARY KEY,
  garage_id               TEXT REFERENCES garages(id) ON DELETE CASCADE, -- NULL = global
  code                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL CHECK (category IN
                            ('fluid','filter','brake','tyre','battery','belt',
                             'electrical','other','suspension','drivetrain',
                             'cooling','engine')),
  default_interval_km     INTEGER,
  default_interval_months INTEGER,
  applies_to_fuel         TEXT   -- CSV of fuel types, NULL = all
);
```

**Seed set:** engine oil, oil filter, air filter, cabin filter, fuel filter, gearbox/ATF oil, coolant, brake fluid, front and rear brake pads, front and rear discs, tyres, battery, timing belt, serpentine belt, spark plugs, wiper blades, aircon service.

### 4.4 Vehicles and usage

```sql
CREATE TABLE vehicles (
  id                  TEXT PRIMARY KEY,
  garage_id           TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  nickname            TEXT NOT NULL,
  plate               TEXT,
  make                TEXT,
  model               TEXT,
  year                INTEGER,
  engine_cc           INTEGER,
  vehicle_type        TEXT NOT NULL DEFAULT 'car'
                        CHECK (vehicle_type IN ('car','motorcycle')),
  fuel_type           TEXT CHECK (fuel_type IN ('petrol','diesel','hybrid','ev')),
  transmission        TEXT CHECK (transmission IN ('manual','auto')),
  vin                 TEXT,
  purchase_date       TEXT,
  purchase_price      INTEGER,          -- minor units
  current_odometer_km INTEGER NOT NULL DEFAULT 0,
  odometer_updated_on TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE odometer_readings (
  id          TEXT PRIMARY KEY,
  garage_id   TEXT NOT NULL,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reading_km  INTEGER NOT NULL,
  recorded_on TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual','service','renewal'))
);
```

`odometer_readings` is append-only and powers usage projection. Update the cached `vehicles.current_odometer_km` in the same transaction when inserting a newer reading.

### 4.5 Maintenance

```sql
CREATE TABLE maintenance_intervals (
  id              TEXT PRIMARY KEY,
  garage_id       TEXT NOT NULL,
  vehicle_id      TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  part_type_id    TEXT NOT NULL REFERENCES part_types(id),
  interval_km     INTEGER,
  interval_months INTEGER,
  is_active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (vehicle_id, part_type_id),
  CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
);

CREATE TABLE service_records (
  id            TEXT PRIMARY KEY,
  garage_id     TEXT NOT NULL,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  serviced_on   TEXT NOT NULL,
  odometer_km   INTEGER NOT NULL,
  workshop_name TEXT,
  labour_cost   INTEGER,          -- minor units; the work, not the parts
                                  -- grand total = labour + SUM(line totals),
                                  -- computed on read, never stored
  invoice_key   TEXT,             -- SUPERSEDED by service_attachments (0015),
                                  -- always NULL, kept to avoid a table rebuild
  notes         TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE service_items (
  id                TEXT PRIMARY KEY,
  garage_id         TEXT NOT NULL,
  service_record_id TEXT NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
  part_type_id      TEXT NOT NULL REFERENCES part_types(id),
  brand             TEXT,
  spec              TEXT,
  quantity          REAL NOT NULL DEFAULT 1,
  unit_cost         INTEGER,      -- minor units
  warranty_months   INTEGER
);
```

**A `service_item` resets a maintenance clock, not the parent record.** A visit with no line items resets nothing.

**Baseline problem.** Vehicles you already own have history predating the app. On vehicle creation, offer a per-item "last done" capture (date and/or odometer). Blank items are status `unknown` and excluded from alerts rather than shown as overdue. Store these as a synthetic `service_record` flagged `notes = 'baseline'`, so the derivation logic needs no special case.

### 4.6 Renewals

```sql
CREATE TABLE renewals (
  id           TEXT PRIMARY KEY,
  garage_id    TEXT NOT NULL,
  vehicle_id   TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('road_tax','insurance','inspection','warranty')),
  provider     TEXT,
  reference_no TEXT,
  issued_on    TEXT,
  expires_on   TEXT NOT NULL,
  cost         INTEGER,           -- minor units
  document_key TEXT,
  notes        TEXT
);
```

Renewals are immutable historical records. Renewing inserts a **new row**; the active one per `(vehicle, type)` is the greatest `expires_on`. This preserves cost history for forecasting.

### 4.7 Budgeting

```sql
CREATE TABLE cost_estimates (
  id             TEXT PRIMARY KEY,
  garage_id      TEXT NOT NULL,
  vehicle_id     TEXT REFERENCES vehicles(id) ON DELETE CASCADE, -- NULL = garage default
  part_type_id   TEXT NOT NULL REFERENCES part_types(id),
  estimated_cost INTEGER NOT NULL,   -- minor units
  source         TEXT NOT NULL CHECK (source IN ('manual','derived')),
  updated_at     TEXT NOT NULL
);
```

`derived` estimates are the mean of the garage's own historical `unit_cost * quantity` for that part type. Surface as suggestions the user accepts or overrides, never applied silently.

### 4.8 Indexes

```sql
CREATE INDEX idx_vehicles_garage      ON vehicles(garage_id) WHERE is_active = 1;
CREATE INDEX idx_odo_vehicle_date     ON odometer_readings(vehicle_id, recorded_on DESC);
CREATE INDEX idx_service_vehicle_date ON service_records(vehicle_id, serviced_on DESC);
CREATE INDEX idx_items_record         ON service_items(service_record_id);
CREATE INDEX idx_items_parttype       ON service_items(part_type_id);
CREATE INDEX idx_renewals_lookup      ON renewals(vehicle_id, type, expires_on DESC);
CREATE INDEX idx_intervals_vehicle    ON maintenance_intervals(vehicle_id) WHERE is_active = 1;
CREATE INDEX idx_members_user         ON garage_members(user_id);
```

Every `garage_id` column is filtered on every query and needs an index.

---

## 5. Tenant isolation (replaces v1's Row Level Security)

**D1 has no row-level security.** This is the largest structural difference from the Supabase design. Tenant isolation is enforced by application code with nothing behind it to catch a mistake, and a forgotten `WHERE garage_id = ?` is a cross-tenant data leak.

### 5.1 Required pattern

Every request resolves a scope once, at the handler edge:

```ts
type Scope = { userId: string; garageId: string; role: Role };
```

All data access goes through a repository constructed with that scope. **No route handler may import the D1 binding or the Drizzle client directly.**

```ts
export class VehicleRepo {
  constructor(private db: DrizzleD1, private scope: Scope) {}

  async list() {
    return this.db.select().from(vehicles)
      .where(and(
        eq(vehicles.garageId, this.scope.garageId),   // applied here, once
        eq(vehicles.isActive, 1)
      ));
  }
}
```

### 5.2 Enforcement

Discipline alone is insufficient. Implement at least two of:

1. **CI lint rule** rejecting any reference to `env.DB` outside `src/worker/data/`.
2. **A base repository** whose protected query builder always injects the garage predicate, so a subclass cannot build an unscoped query without deliberately bypassing it.
3. **Two-garage integration tests** seeding two tenants and asserting every read endpoint returns nothing for the wrong scope. This is the highest-value test suite in the project; write it in Phase 1, not when a second user appears.

### 5.3 Write-path validation

Reads are not the only exposure. On every write, verify that referenced foreign keys belong to the caller's garage before inserting. A client posting a `vehicle_id` from another garage must be rejected, not trusted.

---

## 6. Derived logic

### 6.1 Usage rate

Trailing 180-day window per vehicle:

```
avg_km_per_day = (max(reading_km) - min(reading_km)) / (max(date) - min(date))
```

Requires at least two readings spanning at least 14 days; otherwise fall back to 30 km/day and flag the projection **low confidence** in the UI. Discard readings that decrease relative to an earlier date as data entry errors rather than producing negative rates.

### 6.2 Maintenance due status

For each `(vehicle, part_type)` with an active interval:

1. Baseline = most recent `service_item` of that part type; take its record's `serviced_on` and `odometer_km`. No baseline → `unknown`, prompt for setup, exclude from alerts.
2. `due_km = baseline_odometer + interval_km`
3. `due_date_by_time = baseline_date + interval_months`
4. `projected_date_by_km = today + (due_km - current_odometer) / avg_km_per_day`
5. `effective_due_date = min(due_date_by_time, projected_date_by_km)`

| Condition | Status |
|---|---|
| `current_odometer >= due_km` OR `today >= due_date_by_time` | `overdue` |
| `effective_due_date <= today + due_soon_days` OR `due_km - current_odometer <= due_soon_km` | `due_soon` |
| otherwise | `ok` |

Implement as a SQL view `v_maintenance_due`. See §11.4 for why this must not be a JS loop.

### 6.3 Renewal status

Same bands, date-only, against the active renewal per `(vehicle, type)`. A missing renewal type is a setup prompt, not an alert.

### 6.4 Cost forecast

`v_upcoming_costs` unions maintenance due within 12 months (valued at `cost_estimate`) with renewals expiring within 12 months (valued at the previous `cost`), grouped by month and vehicle. All arithmetic in integer minor units; format to currency only at the UI boundary.

### 6.5 Run rate

Trailing 12 months per vehicle: total spend (services plus renewals) over distance (odometer delta), giving cost per km and per month. Depreciation from `purchase_price` shown separately, labelled an estimate, off by default.

---

## 7. API surface

All routes under `/api`, all requiring Access identity, all scoped.

```
GET    /api/me                          → user, settings, garages
PATCH  /api/me/settings

GET    /api/vehicles                    → list with worst status
POST   /api/vehicles                    → creates and seeds intervals
GET    /api/vehicles/:id
PATCH  /api/vehicles/:id
DELETE /api/vehicles/:id                → soft archive

POST   /api/vehicles/:id/odometer
GET    /api/vehicles/:id/maintenance    → from v_maintenance_due
PATCH  /api/vehicles/:id/intervals/:pid

GET    /api/vehicles/:id/services
POST   /api/vehicles/:id/services       → record + items, one transaction
PATCH  /api/services/:id
DELETE /api/services/:id

GET    /api/vehicles/:id/renewals
POST   /api/vehicles/:id/renewals
PATCH  /api/renewals/:id

GET    /api/dashboard                   → single aggregated attention payload
GET    /api/costs/forecast
GET    /api/costs/runrate
GET    /api/estimates
PUT    /api/estimates/:id

GET    /api/part-types                  → global + garage custom
POST   /api/garages/:id/members         → owner only
DELETE /api/garages/:id/members/:userId → owner only
```

`GET /api/dashboard` returns everything the landing page needs in one round trip. Do not compose it client-side from five requests.

---

## 8. Feature specification

### 8.1 Dashboard

- **Attention list:** all `overdue` and `due_soon` items across active vehicles, sorted overdue first then by `effective_due_date`. Each row: vehicle, item, status pill, human-readable timing ("overdue by 12 days", "due in about 5 weeks").
- **Vehicle cards:** nickname, odometer with reading age, worst status, one-tap odometer action.
- **Stale odometer warning:** if `odometer_updated_on` is over 45 days old, prompt. Every projection decays silently without fresh readings. See §11.7.

### 8.2 Vehicle detail

Sections: Overview (specs, inline odometer edit, usage rate with confidence indicator), Maintenance (intervals with last done, next due, status, inline editing — **grouped by part category, with overdue and due-soon items pinned above the groups** so attention is never hidden inside a collapsed section), Service history (reverse chronological, expandable to line items), Renewals (active per type with countdown, plus history), Costs (run rate, spend by category, 12-month trend).

### 8.3 Add vehicle

Only `nickname` required. On save: create vehicle, seed intervals from `part_types` defaults filtered by `applies_to_fuel`, insert initial odometer reading if given, then prompt for baselines.

### 8.4 Log service

The highest-friction flow, needing the most care. Vehicle → date (default today) → odometer (prefilled, validated ≥ current) → workshop → line items. The part type picker **pins the vehicle's overdue and due-soon items to the top**, with the remaining part types grouped by category. Brand and spec autocomplete from the garage's own history. Labour is entered as its own figure, since it is a real cost that is not a line item — the owner frequently buys the parts and pays a workshop for the fitting alone. The grand total is **shown, not typed**: it is parts + labour, computed, so no two figures on the form can disagree. On save, confirm which clocks were reset.

### 8.5 Quick odometer update

One tap from the dashboard, numeric keypad, single field, save and dismiss. This happens standing at a petrol pump and must take under ten seconds.

### 8.6 Budgets

**Forecast:** stacked bar of estimated monthly spend over 12 months by vehicle, itemised table beneath, inline-editable estimates.
**Run rate:** cost per km and per month by vehicle, compared across the fleet.

### 8.7 Settings

Units, currency, date format, timezone, due-soon thresholds, garage name, member management.

---

## 9. UX requirements

Desktop-first, responsive down to 375px. Dark theme only -- the palette lives in `tailwind.config.js` as the base colours, so there are no `dark:` variants anywhere. Status colours green, amber, red, grey, always paired with text and never colour alone. Relative dates primary ("in about 5 weeks"), absolute secondary. Empty states that guide rather than blank tables. Optimistic updates with rollback. Dashboard response cached client-side so it renders on a poor connection.

---

## 10. Phasing

> Current progress, and what to pick up next, live in `docs/status.md`. This
> section defines the phases; that file records how far they have got.

**Phase 1 — Core.** Access setup, user and garage bootstrap, vehicle CRUD, odometer logging, intervals with seeded defaults, service records and items, renewals, dashboard status computation, and the isolation test suite from §5.2.
*Done when you can stop using your current spreadsheet.*
**In progress.** Every API endpoint and the isolation suite are built. The
client is missing service records (§8.4), renewals, vehicle edit and delete,
and interval inline editing, so the "stop using the spreadsheet" bar is not
met yet.

**Phase 2 — Money.** Cost estimates, forecast, run rate, spend breakdowns, derived estimates. *Not started.*

**Phase 3 — Multi-user.** Invitations, role enforcement in UI, garage switching. *Not started.*

**Phase 4 — Automation.** Cron reminder emails, ~~R2 document upload~~ (**built 2026-09-10** for service records; renewals still unbuilt), scheduled database export (§11.6). *Not started — but see §11.6, the export is worth pulling forward before bulk-entering historical records.*

---

## 11. Risk register and pivot triggers

Reviewed for things that would force an architectural change later, ordered by the cost of discovering them late.

### 11.1 Access cannot do open self-service signup — HIGH

Cloudflare Access is an allowlist. Every user is added by hand in the Zero Trust dashboard before they can log in. If this project ever wants public registration, Access is the wrong tool and must be replaced entirely.

**Pivot cost:** low *if* §1.3's identity isolation holds. Swapping Access for Better Auth or a hosted provider inside the Worker touches one file plus a login route. Doing it after auth logic has leaked into twenty handlers is a rewrite.
**Trigger:** the first time you want someone to sign up without you touching a dashboard.
**Action now:** keep `getAuthenticatedUser()` as the sole point of contact with Access.

### 11.2 No row-level security — HIGH

Covered in §5. The database will return another garage's rows if the predicate is missing. Supabase would have refused.

**Pivot cost:** high, because the trigger is usually discovering a leak rather than anticipating one.
**Trigger:** a second developer joins, or users grow beyond people you know personally.
**Action now:** build §5.2's enforcement in Phase 1. The two-garage test is the cheapest insurance in this project.

### 11.3 The 50-user Access ceiling — LOW

The free Zero Trust plan supports 50 users. Seats are consumed by authentication events and held until the user is removed; past 50, new users are blocked rather than billed. Paid is $7 per user per month, a real cost at any scale.

**Trigger:** approaching 40 users.
**Action now:** none, beyond knowing the wall exists.

### 11.4 Workers CPU limit — MEDIUM

The free tier allows 10ms CPU per invocation. D1 query time is I/O wait and does not count against it, and Access identity is resolved at the edge rather than by in-Worker JWT validation, so the realistic consumers are JSON serialisation and any JavaScript computation over result sets.

**This is why §1.3 mandates SQL aggregation.** Computing status for twelve vehicles across twenty part types each in a JS loop and then serialising is exactly the shape of code that hits the ceiling. The same logic as a view costs almost nothing.

**Trigger:** `wrangler tail` showing CPU near the limit, or `Error 1102`.
**Action now:** implement §6 as views; keep `/api/dashboard` returning a pre-shaped payload.

### 11.5 Timezone drift on date arithmetic — MEDIUM

Workers run in UTC. At UTC+8, "today" computed in UTC is the previous day for eight hours of every local day, so an item can display as due or overdue a day early or late. On a road tax expiry, that is the kind of quiet wrongness that destroys trust in the tool.

**Action now:** store `timezone` on the user (§4.2), compute "today" in that zone for all status comparisons, store calendar dates as `YYYY-MM-DD` with no time component, and never round-trip a calendar date through a UTC timestamp.

### 11.6 D1 durability and backup — BUILT 2026-08-28

**Retention was verified rather than assumed, as this section asked.** D1 Time Travel restores to any bookmark within **30 days** on this account (`wrangler d1 time-travel info fleet --timestamp=<31 days ago>` is rejected). So the risk this section described as unbounded was already bounded at 30 days, for free.

That narrows what an export is for, rather than removing the need. Time Travel cannot cover: anything older than 30 days; loss of the Cloudflare account, since the recovery mechanism lives inside the thing it protects; and portability, since a bookmark is not a file — §11.9's claim that exiting to Postgres is a weekend holds only if the data is in a form you can hold.

**Built:** a nightly Cron Trigger on `fleet-portal` writing the whole database as JSON to R2 (`portals-backup`, `fleet/YYYY-MM-DD.json`), retaining **90 days** — deliberately longer than Time Travel's 30, since matching it would add nothing on the time axis. It covers both portals, because there is one D1.

Two things turned out to matter more than the thirty-line estimate suggested. Table discovery is driven by `sqlite_master`, never a hardcoded list, so a table added later is backed up without anyone remembering. And D1 **ignores** `PRAGMA foreign_keys = OFF`, so the standard restore idiom does not work and insert order is derived from `PRAGMA foreign_key_list` instead.

The restore path runs in CI (`apps/odometry/tests/backup.test.ts`) and was exercised by hand against the local database on 2026-08-28: 208 rows across 15 tables, restored, foreign key check clean.

### 11.7 Odometer staleness — HIGH (product risk, not technical)

The most likely cause of this project failing is none of the above. It is that you stop entering odometer readings after six weeks, projections silently decay, the dashboard starts being wrong, you stop trusting it, and it joins the pile of abandoned side projects.

**Action now:** §8.5's one-tap update and §8.1's staleness warning are load-bearing, not polish. Phase 1 without them ships broken.

### 11.8 workers.dev is positioned as hobby-tier — LOW

Cloudflare describes workers.dev as a free website intended for personal projects that are not business-critical, and recommends a custom domain for production workloads.

**Trigger:** the app becoming something you would be genuinely upset to lose.
**Pivot cost:** near zero. Add a domain and point it at the Worker; worker-level Access policies cover new hostnames automatically. Buy through a registrar that sells at cost, since cheap-first-year TLDs renew at several times the headline price.

### 11.9 Vendor lock-in — LOW

Better than it looks. D1 is SQLite, so schema and data export to Postgres mechanically. Hono runs on any JS runtime. The genuinely Cloudflare-specific surfaces are the Access identity call and the D1 binding, both thin and both already isolated by §5.1 and §11.1.

**Assessment:** exiting to Postgres plus self-hosted auth is a weekend, not a rewrite. Acceptable.

### 11.10 D1 read replication — LOW

If replication is enabled later, a write followed immediately by a read may return stale data, surfacing as "I logged the service but the status didn't update."

**Action now:** do not enable read replication; single-user write volume makes it pointless. If enabled later, use D1's Sessions API for read-your-writes consistency.

---

## 12. Open decisions

| Question | Impact | Default if unresolved |
|---|---|---|
| ~~Fuel logging~~ **RESOLVED 2026-09-03** | Enables L/100km, not just cost/km | Built as `fuel_fills` (migration 0013), entered from Coinbox. See below |
| Depreciation in run rate | Materially changes cost/km | Separate, labelled estimate, off by default |
| ~~Document storage~~ **RESOLVED 2026-09-10** | Receipts on service records | Built as `service_attachments` + R2 bucket `portals-docs` (migration 0015). Renewals still unbuilt |
| Email provider for reminders | Needs a free-tier transactional sender | Decide at Phase 4 |

**On fuel logging.** §1.2 put "fuel and economy logging" out of scope for v1 and
the row above left room for a `fuel_logs` table. What was built is
`fuel_fills`, and it differs from the sketch in three ways worth recording:

- **Entry happens in Coinbox, not here.** The litres and the ringgit are read
  off the same receipt, and splitting them across two apps is how odometer
  logging stops -- which §11.7 rates the likeliest cause of this project
  failing. This portal reads fills (`GET /api/vehicles/:id/fuel`) and has no
  POST for them.
- **`is_full_tank` is not optional.** Consumption is only computable full tank
  to full tank. A partial fill divided by its own distance gives a number in an
  entirely plausible range that is simply wrong, so partial fills are carried
  into the segment that ends at the next full one.
- **No cost column on the table.** It is garage-scoped and a garage is shared,
  so a price there would be readable by every co-member. The money stays in
  Coinbox behind the ledger predicate.

§6.5's run rate (spend over distance) is still unbuilt on this side; Coinbox's
dashboard already computes cost per km from the money it owns.
