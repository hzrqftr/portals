# CLAUDE.md

Workspace instructions for Claude Code. Read this before making changes, then
read the `CLAUDE.md` in whichever app you are working on.

## The workspace

Two portals, one Cloudflare account, one D1 database, one repo.

| App | What it is | Worker | Spec |
|---|---|---|---|
| `apps/odometry` | Vehicle fleet portal: maintenance, renewals, cost forecasting | `fleet-portal` | `docs/fleet-portal-spec.md` |
| `apps/coinbox` | Personal expense ledger | `coinbox` | `docs/coinbox-spec.md` |
| `packages/core` | Identity, money, dates, repository base, shared UI | — | — |

**Resuming work? Read `docs/status.md` first.** It records what is actually
built, what is not, and what to pick up next — the specs describe the
destination, not the current position.

## One database, one repo

This is the load-bearing structural decision. **The database is the repo
boundary, not the portal.** A new system that shares the D1 goes in this repo;
one with its own D1 gets its own. Four reasons, and none is a style preference:

1. **D1's migration ledger is a single table keyed by bare filename, with a
   `UNIQUE` constraint.** Two repos each with a `migrations/` folder against
   one database would see each other's filenames as already applied and
   **silently skip** them. Not an error — missing tables, discovered in
   production.
2. **Coinbox's schema references Odometry's tables** (`transactions.vehicle_id
   → vehicles.id`, ownership → `users.id`). Two repos means duplicate Drizzle
   definitions that go stale without warning.
3. **The cross-tenant guarantee spans both portals** — "a garage co-member must
   not see the owner's ledger" needs `garage_members` and the ledger in one
   schema to be testable at all.
4. **`scripts/check-db-imports.mjs` walks one repo root.** A second repo would
   be outside its view, and invariant 3 would decay from a build failure into
   a good intention.

Consequences that follow, and must not be "tidied up":

- **`migrations/` lives at the workspace root.** One database, one linear
  sequence. Never renumber or rename an applied migration: the ledger stores
  bare filenames, so a rename makes wrangler re-run it.
- **`wrangler.jsonc` at the root declares no Worker.** It exists only so
  `wrangler d1` commands have one unambiguous home instead of one portal's
  config driving the other's migrations.
- **`.wrangler/state` is at the root and both apps point at it** via the Vite
  plugin's `persistState`. Two portals sharing one database in production must
  share one locally, or a transaction cannot see the vehicle it references.
- **The D1 database is named `fleet`.** Historical — it predates Coinbox.
  Renaming a D1 database is a dashboard action with no upside, and the name is
  invisible to users. It is not an oversight.

## Working with the owner

The owner is comfortable with product decisions but **not deeply familiar with
Cloudflare Workers, D1, Drizzle, or Hono.** This changes how you should work:

- Explain what you changed in plain language, not just a diff summary. Say what
  it does and why, not only which files moved.
- When a decision has a tradeoff, state it and ask, rather than picking
  silently.
- Do not assume review will catch mistakes. Write the test that proves the
  behaviour instead.
- Flag anything that needs a Cloudflare or Google dashboard action, since you
  cannot do those. Give exact click paths.

## Stack

| Layer | Tool |
|---|---|
| Runtime | Cloudflare Workers (static assets + API in one Worker, per portal) |
| Frontend | React 18, TypeScript, Vite, Tailwind, TanStack Query |
| API | Hono under `/api/*` |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| Auth | Cloudflare Access, Google IdP, allowlist |
| Validation | Zod, shared between client and server |

## Non-negotiable invariants

Every one of these is invisible when broken. Code that violates them will look
and behave correctly in normal use. Do not violate them, and do not "simplify"
them away. Domain invariants live in each app's own `CLAUDE.md`.

### 1. Money is always `INTEGER` in minor units

Store sen, not ringgit. `RM 245.50` is `24550`. Never use `REAL` or `FLOAT` for
money anywhere — SQLite has no decimal type and floats silently corrupt totals.
Convert to display format only at the UI boundary, via `@portals/core`.

### 2. Tenant scoping goes through repositories, never handlers

`env.DB` and the Drizzle client may only be imported inside an app's
`src/worker/data/` or `packages/core/src/worker/`. Route handlers receive a
repository already constructed with a scope.

D1 has **no row-level security** — nothing behind your code will catch a
missing filter, and a missing filter is a data leak between users.

**The two portals scope on different columns, on purpose.** Odometry filters on
`garage_id`; Coinbox filters on `ledger_id`. `BaseScopedRepo` in
`packages/core` takes the predicate as an abstract method precisely so neither
can inherit the other's answer by accident. A garage is shared so a household
can co-own a fleet; a ledger is never shared.

On writes, validate that referenced foreign keys belong to the caller before
inserting. Never trust an ID from the client.

### 3. Identity comes only from `getAuthenticatedUser()`

That function in `packages/core/src/worker/auth.ts` is the sole point of
contact with Cloudflare Access, **across both portals**. Do not call
`getIdentity()` anywhere else. This keeps a future swap to self-service signup
to a single file.

Identity and authorisation are deliberately separate: core answers "who is
this", and each app's `src/worker/scope.ts` answers "what may they see".

### 4. Aggregate in SQL, never in JavaScript

Workers allow 10ms CPU per request. Rollups and forecasts are SQL views or
CTEs. Do not fetch rows and loop over them in JS — that pattern works with a
handful of rows and fails silently as data grows.

### 5. Dates are calendar dates, computed in the user's timezone

The Worker runs in UTC; the owner is at UTC+8. "Today" in UTC is yesterday for
eight hours of every local day.

- Store calendar dates as `TEXT` `YYYY-MM-DD`, no time component.
- Compute "today" using `users.timezone` via `todayIn()` in `@portals/core`,
  never bare `new Date()`.
- **No SQL view may call `date('now')` or `CURRENT_DATE`.** Views expose
  parameter-free facts; the date comparison takes a bound parameter.

### 9. Do not enable D1 read replication

It introduces read-after-write staleness for no benefit at this write volume.

## Definition of done

1. Zod schemas validate input at the API boundary.
2. New tables or columns have a migration in the root `migrations/`, applied
   locally and committed.
3. Any new list or read endpoint is added to that app's isolation test.
4. The change is explained in plain language in the PR or summary.

## The cross-tenant tests

`apps/*/tests/isolation.test.ts` are the most important tests in this repo.
Each seeds two tenants, calls **every** read endpoint as one, and asserts
nothing belonging to the other comes back.

**When you add an endpoint, add it to the list. No exceptions.** These suites
stand in for the row-level security D1 does not have.

Coinbox's suite carries an extra dimension the fleet portal does not need: a
**garage co-member** must still get their own ledger. That is the case this
whole two-axis design exists to guarantee.

**A test that passes proves nothing until it has been seen to fail.** When you
change isolation code or the lint, break it on purpose first, watch the failure,
then restore. Both were verified that way when they were written.

## Commands

```bash
npm test                       # lint:isolation + every workspace's tests
npm run lint:isolation         # tenant-isolation lint, whole tree

npm run dev   -w odometry      # or -w coinbox
npm run build -w odometry
npm run deploy -w odometry     # ships it, see below

npm run db:apply:local         # apply migrations to the shared local D1
npm run db:apply:remote
npm run db:query:local -- --command "SELECT ..."
npm run db:new -- <name>       # create a migration file

npx wrangler tail -c apps/odometry/wrangler.jsonc   # live logs, incl. CPU warnings

node scripts/restore.mjs <backup.json>                  # restore into local D1
node scripts/restore.mjs <backup.json> --dry-run        # show what it would run
node scripts/restore.mjs <backup.json> --remote --i-mean-it
```

### Backups

A nightly Cron Trigger on the **fleet-portal** Worker writes the whole database
to R2 (`portals-backup`, key `fleet/YYYY-MM-DD.json`, 90-day retention). One
D1 means one backup covering both portals, which is why it is not Coinbox's
job even though Coinbox is what motivated it.

The logic is `packages/core/src/worker/backup.ts` -- **the one legitimate
unscoped reader in the system.** It sits outside `BaseScopedRepo` rather than
widening it, because widening it would put an unscoped read in the path of
every repository in both portals to serve one caller that runs on a cron.

Retention is 90 days on purpose: **D1 Time Travel already covers 30** (measured
2026-08-28, not assumed), so a shorter window would add nothing. The export
earns its keep on what Time Travel cannot do -- survive loss of the Cloudflare
account, and hand you a file you can read, diff and move to Postgres.

Fetch one with `npx wrangler r2 object get portals-backup/fleet/<date>.json
--file=b.json --remote`. `apps/odometry/tests/backup.test.ts` runs the restore
round trip on every `npm test`, because a backup nobody has restored from is a
belief rather than a backup.

### `npm run deploy -w <app>` is ordered deliberately

`npm --prefix ../.. run test && npm run build && npm --prefix ../.. run db:apply:remote && wrangler deploy`

Two orderings are load-bearing, both learned the hard way:

- **The migration runs before the deploy.** The new Worker reads columns
  production does not have until the migration lands. Deploying first is a live
  500 for however long the gap is. It has happened.
- **The migration runs after the tests and the build.** A migration is the one
  step that cannot be rolled back by redeploying, so nothing touches the
  production database until the code that needs it is known to compile and pass.

Note the test step runs the **whole workspace**, not just the app being
deployed. That is deliberate: both portals share a database and
`packages/core`, so a change in either can break the other.

`deploy:worker` skips all of it, for redeploying unchanged code (a rollback, a
binding change). Do not reach for it to skip a failing test.

**Check what a migration will do to real data before running it against
`--remote`.** Row counts before and after, and `PRAGMA foreign_key_check` after
anything that rebuilds a table.

## Layout

```
migrations/            # ONE folder, one sequence, shared database
wrangler.jsonc         # D1 admin only, declares no Worker
scripts/
  check-db-imports.mjs # isolation lint, walks the whole tree
docs/
apps/
  odometry/  coinbox/
    src/worker/
      index.ts     # Hono app, entry point
      scope.ts     # this portal's ownership axis
      data/        # repositories. The ONLY place env.DB is imported
      routes/      # handlers. No direct DB access
      schema/      # Drizzle tables owned by this portal
    src/client/
    src/shared/zod/
    tests/
packages/core/
  src/
    money.ts dates.ts zod.ts      # isomorphic
    worker/auth.ts                # THE only Access caller, both portals
    worker/{errors,repo,types}.ts
    schema/                       # users + user_settings ONLY
    client/                       # api, Sheet, form, layout
  tailwind-preset.js              # the shared palette
```

## Owner-only tasks

You cannot do these. Ask, and give exact steps:

- Creating the Google OAuth client in Google Cloud Console
- Adding **Google** (not Google Workspace) as the IdP in Cloudflare Zero Trust
- Creating each Access application and its email allowlist
- Enabling Access on a Worker
- Adding or removing allowlisted users

## Known traps

- **`wrangler dev` has no real Access.** The `access.dev` block in each app's
  `wrangler.jsonc` supplies a simulated identity, so `getIdentity()` behaves the
  same locally as deployed and there is no dev-only branch in `auth.ts`.
- **Each portal has its own Access AUD.** Accepting the other's audience would
  let a token minted for one portal open the other.
- **Foreign keys are not enforced by default in D1.** Ensure
  `PRAGMA foreign_keys = ON`.
- **SQLite has no enums or booleans.** Use `TEXT` with `CHECK` constraints, and
  `INTEGER` 0/1.
- **D1's SQLite has a low `SQLITE_MAX_COMPOUND_SELECT`.** A seven-term
  `UNION ALL` chain fails with `too many terms in compound SELECT`. Write
  repeated `INSERT ... SELECT` statements instead. Multi-row `VALUES` is fine.
- **D1 ignores `PRAGMA foreign_keys = OFF`.** It keeps enforcing constraints
  statement by statement, so the textbook SQLite restore idiom -- suspend
  foreign keys, insert in any order, check at the end -- does not work. Insert
  order is load-bearing instead, and `packages/core/src/worker/backup.ts`
  derives a parents-first order from `PRAGMA foreign_key_list`. The symptom is
  `SQLITE_CONSTRAINT_FOREIGNKEY` on the first child row, which reads like bad
  data rather than an ignored pragma.
- **`UNIQUE` does not constrain NULLs in SQLite.** A `UNIQUE` including a
  nullable "applies to everything" column allows unlimited duplicates whenever
  it is NULL. Use partial unique indexes or `COALESCE(col, '')`.
- **Parameters bind by position in the statement text, not by clause.** Adding a
  `?` to a CTE's SELECT list shifts every later bind, including the tenant id in
  its own `WHERE`. The result is a silently empty response, not an error.
- **The isolation lint's allow lists are anchored regexes, not path prefixes.**
  They were prefixes once; when code moved under `apps/`, every one stopped
  matching and the lint reported success while enforcing nothing. If you move
  files, update the regexes and prove one still fails.

## Style

TypeScript strict mode, no `any`. Prefer explicit over clever. Comment the
non-obvious *why*, not the *what*. Keep components under roughly 200 lines.

**Desktop-first Tailwind, responsive down to 375px, dark theme only.** The
palette is `packages/core/tailwind-preset.js` (`page`, `surface`, `inset`,
`edge`, `ink*`, `status.*`), not a `dark:` overlay — there are no `dark:`
variants anywhere and adding one means the palette is wrong. Do not reintroduce
raw Tailwind colours like `stone-600` or `bg-white`; they look correct in
isolation and wrong on the page.

Each app's Tailwind `content` must include
`../../packages/core/src/client/**/*.{ts,tsx}`, or the shared components' classes
are purged and the chrome renders unstyled.

`:root { color-scheme: dark }` in each app's `index.css` is load-bearing:
without it the native date picker and every `<select>` render white.
