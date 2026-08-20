# CLAUDE.md

Project instructions for Claude Code. Read this before making changes.

## Project

A personal vehicle fleet portal: maintenance status, road tax and insurance renewals, and cost forecasting for a small fleet. Single Cloudflare Worker serving a React SPA and a JSON API.

Full design lives in `docs/fleet-portal-spec.md`. **That spec is authoritative.** This file lists the rules that are easy to break without noticing.

## Working with the owner

The owner is comfortable with product decisions but **not deeply familiar with Cloudflare Workers, D1, Drizzle, or Hono.** This changes how you should work:

- Explain what you changed in plain language, not just a diff summary. Say what it does and why, not only which files moved.
- When a decision has a tradeoff, state it and ask, rather than picking silently.
- Do not assume review will catch mistakes. Write the test that proves the behaviour instead.
- Flag anything that needs a Cloudflare or Google dashboard action, since you cannot do those. Give exact click paths.

## Stack

| Layer | Tool |
|---|---|
| Runtime | Cloudflare Workers (static assets + API in one Worker) |
| Frontend | React 18, TypeScript, Vite, Tailwind, TanStack Query |
| API | Hono under `/api/*` |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| Auth | Cloudflare Access, Google IdP, allowlist |
| Validation | Zod, shared between client and server |

## Non-negotiable invariants

Every one of these is invisible when broken. Code that violates them will look and behave correctly in normal use. Do not violate them, and do not "simplify" them away.

### 1. Money is always `INTEGER` in minor units

Store sen, not ringgit. `RM 245.50` is `24550`. Never use `REAL` or `FLOAT` for money anywhere — SQLite has no decimal type and floats silently corrupt totals. Convert to display format only at the UI boundary.

### 2. Tenant scoping goes through repositories, never handlers

`env.DB` and the Drizzle client may only be imported inside `src/worker/data/`. Route handlers receive a repository already constructed with a `Scope { userId, garageId, role }`.

Every query filters on `garage_id`. D1 has **no row-level security** — nothing behind your code will catch a missing filter, and a missing filter is a data leak between users.

On writes, validate that referenced foreign keys belong to the caller's garage before inserting. Never trust an ID from the client.

### 3. Identity comes only from `getAuthenticatedUser()`

That function in `src/worker/auth.ts` is the sole point of contact with Cloudflare Access. Do not call `ctx.access.getIdentity()` anywhere else. This keeps a future swap to self-service signup to a single file.

The dev-mode branch inside it must be guarded on `env.ENVIRONMENT === "development"` and must never be reachable in production.

### 4. Aggregate in SQL, never in JavaScript

Workers allow 10ms CPU per request. Status computation, cost rollups, and forecasts are SQL views. Do not fetch rows and loop over them in JS — that pattern works with two vehicles and fails silently as data grows.

`GET /api/dashboard` returns one pre-shaped payload. Do not have the client assemble it from several requests.

### 5. Dates are calendar dates, computed in the user's timezone

The Worker runs in UTC; the owner is at UTC+8. "Today" in UTC is yesterday for eight hours of every local day, which makes renewals show as due on the wrong date.

- Store calendar dates as `TEXT` `YYYY-MM-DD`, no time component.
- Compute "today" using `users.timezone`, never bare `new Date()`.
- Never round-trip a calendar date through a UTC timestamp.

### 6. Due dates are derived, never stored

Compute from `last service + interval rule`. There is no "next service mileage" column and there must never be one. If you find yourself wanting to cache a due date, cache it in a view.

### 7. A `service_item` resets the maintenance clock, not the `service_record`

A service visit with no line items resets nothing. The baseline for any part type is the most recent `service_item` of that type.

### 8. Renewals are immutable

Renewing road tax or insurance **inserts a new row**. Never update `expires_on` in place — cost history drives the forecast. The active renewal per `(vehicle, type)` is the greatest `expires_on`.

### 9. Do not enable D1 read replication

It introduces read-after-write staleness for no benefit at this write volume.

## Definition of done

A feature is not complete until:

1. Zod schemas validate input at the API boundary.
2. New tables or columns have a Drizzle migration, applied locally and committed.
3. Any new list or read endpoint is covered by the cross-tenant test (below).
4. The change is explained in plain language in the PR or summary.

## The cross-tenant test

Lives in `tests/isolation.test.ts` and is the most important test in this project. It seeds two garages with data in each, then calls **every** read endpoint as user A and asserts nothing belonging to user B is ever returned.

**When you add an endpoint, add it to this test.** No exceptions. This suite is what stands in for the row-level security D1 does not have.

## Commands

```bash
npm run dev                              # Vite + Worker, local
npm run build                            # Production build
npm test                                 # Vitest
npx wrangler deploy                      # Deploy

npx wrangler d1 migrations create fleet <name>
npx wrangler d1 migrations apply fleet --local
npx wrangler d1 migrations apply fleet --remote
npx wrangler d1 execute fleet --local --command "SELECT ..."
npx wrangler tail                        # Live logs, incl. CPU warnings
```

## Layout

```
src/
  worker/
    index.ts        # Hono app, entry point
    auth.ts         # getAuthenticatedUser() — the ONLY Access caller
    data/           # Repositories. The ONLY place env.DB is imported
    routes/         # Handlers. No direct DB access
    schema/         # Drizzle table definitions
  client/
    App.tsx
    routes/
    components/
    api/            # TanStack Query hooks
  shared/
    zod/            # Schemas used by both sides
migrations/
tests/
  isolation.test.ts # See above
docs/
  fleet-portal-spec.md
```

## Owner-only tasks

You cannot do these. Ask, and give exact steps:

- Creating the Google OAuth client in Google Cloud Console
- Adding **Google** (not Google Workspace) as the IdP in Cloudflare Zero Trust
- Creating the Access application and its email allowlist
- Enabling Access on the Worker
- Adding or removing allowlisted users

## Known traps

- **`wrangler dev` has no Access.** `ctx.access.getIdentity()` returns nothing locally; the dev shim in `auth.ts` covers this. Do not work around it elsewhere.
- **Foreign keys are not enforced by default in D1.** Ensure `PRAGMA foreign_keys = ON`.
- **SQLite has no enums or booleans.** Use `TEXT` with `CHECK` constraints, and `INTEGER` 0/1.
- **Odometer readings can be entered out of order.** Discard readings that decrease relative to an earlier date rather than producing negative usage rates.
- **A vehicle with no service history is `unknown`, not `overdue`.** Never alert on items that have no baseline.

## Style

TypeScript strict mode, no `any`. Prefer explicit over clever. Comment the non-obvious *why*, not the *what*. Keep components under roughly 200 lines. Mobile-first Tailwind, designed at 375px.
