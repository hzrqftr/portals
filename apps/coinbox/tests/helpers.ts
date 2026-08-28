import { env, applyD1Migrations } from "cloudflare:test";
import app from "@worker/index";

/**
 * Drives the real Worker -- real middleware, real auth, real scope
 * resolution, real D1 -- with a chosen Access identity.
 *
 * The identity seam is the ExecutionContext. In production Cloudflare
 * populates ctx.access; here the test does. Nothing else is stubbed, so a
 * missing ledger predicate anywhere in the stack shows up in these tests
 * exactly as it would in production.
 */
export function as(email: string) {
  const ctx = {
    access: {
      aud: "test",
      getIdentity: async () => ({ email, name: email.split("@")[0] }),
    },
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;

  return async function request(
    path: string,
    init?: RequestInit & { json?: unknown },
  ): Promise<{ status: number; body: any; text: string }> {
    const { json, ...rest } = init ?? {};
    const req = new Request(`https://coinbox.test${path}`, {
      ...rest,
      ...(json !== undefined
        ? {
            body: JSON.stringify(json),
            headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
          }
        : {}),
    });
    const res = await app.fetch(req, env as never, ctx);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body, text };
  };
}

export async function migrate(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

interface D1Migration {
  name: string;
  queries: string[];
}

/**
 * Wipes tenant data between tests, keeping the schema.
 *
 * The pool's storage isolation is not relied on here: these tests assert on
 * exact identity, and a suite whose correctness depends on someone else's
 * cleanup semantics is one runner upgrade away from passing for the wrong
 * reason.
 *
 * Order matters: children before parents, since foreign keys are on. Odometry
 * tables appear here because both portals share one database -- the co-member
 * fixture below writes real garage rows.
 */
export async function resetDb(): Promise<void> {
  const tables = [
    // Children before parents: transactions and the import tables reference
    // ledgers, so deleting ledgers first fails on foreign keys.
    "import_rows",
    "import_batches",
    "transactions",
    "ledgers",
    "service_items",
    "service_records",
    "odometer_readings",
    "maintenance_intervals",
    "service_templates",
    "renewals",
    "cost_estimates",
    "vehicles",
    "garage_members",
    "user_settings",
    "garages",
    "users",
  ];
  await env.DB.batch([
    ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    env.DB.prepare(`DELETE FROM part_types WHERE garage_id IS NOT NULL`),
    // Ledger-scoped categories go; the 16 global seed rows stay, the same way
    // the global part_types do above.
    env.DB.prepare(`DELETE FROM categories WHERE ledger_id IS NOT NULL`),
  ]);
}

/**
 * Creates a user and their ledger, as first-login bootstrap would, and returns
 * the ledger id.
 *
 * Raw SQL rather than a request through the app: these tests are about what
 * the SCHEMA guarantees, so going through the API would mean a constraint
 * failure and a handler bug look identical.
 */
export async function giveLedger(email: string): Promise<string> {
  const userId = crypto.randomUUID();
  const ledgerId = crypto.randomUUID();
  const now = "2026-08-28T00:00:00.000Z";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, timezone, created_at) VALUES (?, ?, 'Asia/Kuala_Lumpur', ?)`,
    ).bind(userId, email, now),
    env.DB.prepare(
      `INSERT INTO ledgers (id, owner_user_id, name, created_at) VALUES (?, ?, 'My Ledger', ?)`,
    ).bind(ledgerId, userId, now),
  ]);

  return ledgerId;
}

/**
 * Puts `email` into `ownerEmail`'s garage as an editor, by raw SQL.
 *
 * Raw SQL on purpose, twice over. First, Odometry has no member-management
 * endpoint yet (multi-user is Phase 3), so there is no API to do this with.
 * Second, `garages` and `garage_members` are deliberately absent from
 * Coinbox's Drizzle schema -- this app must not be able to type a query
 * against the other portal's ownership axis, and reaching for raw SQL here is
 * the test acknowledging it is deliberately crossing a boundary the
 * application code cannot.
 */
export async function addToGarageOf(ownerEmail: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO garage_members (garage_id, user_id, role)
     SELECT g.id, u.id, 'editor'
       FROM garages g
       JOIN users owner ON owner.id = g.created_by
       JOIN users u ON u.email = ?
      WHERE owner.email = ?`,
  )
    .bind(email, ownerEmail)
    .run();
}

/**
 * Puts a vehicle in `email`'s garage and returns its id.
 *
 * Raw SQL for the same reason as the helpers around it: `vehicles` is
 * Odometry's table and is deliberately absent from Coinbox's Drizzle schema,
 * so the test reaching for it directly is the test acknowledging it is
 * crossing a boundary the application code cannot.
 */
export async function giveVehicle(email: string, nickname: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO vehicles (id, garage_id, nickname, fuel_type, current_odometer_km, is_active, vehicle_type, created_at, updated_at)
     SELECT ?, g.id, ?, 'petrol', 0, 1, 'car', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
       FROM garages g
       JOIN users u ON u.id = g.created_by
      WHERE u.email = ?`,
  )
    .bind(id, nickname, email)
    .run();
  return id;
}

/** Creates a garage owned by `email`, as Odometry's bootstrap would. */
export async function giveGarage(email: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO garages (id, name, created_by, created_at)
       SELECT lower(hex(randomblob(16))), 'My Garage', u.id, datetime('now')
         FROM users u WHERE u.email = ?`,
    ).bind(email),
    env.DB.prepare(
      `INSERT INTO garage_members (garage_id, user_id, role)
       SELECT g.id, u.id, 'owner'
         FROM garages g JOIN users u ON u.id = g.created_by
        WHERE u.email = ?`,
    ).bind(email),
  ]);
}
