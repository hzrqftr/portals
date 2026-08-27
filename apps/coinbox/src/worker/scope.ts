import type { Env, Scope } from "./types";
import { type AuthUser, UnauthorizedError } from "@portals/core/worker";
import { nowIso } from "@portals/core";

/**
 * Coinbox's ownership axis: a LEDGER.
 *
 * Identity comes from getAuthenticatedUser() in @portals/core -- the only
 * thing in either portal that touches Cloudflare Access. What that identity
 * may then see is this file's answer, and it is deliberately unrelated to
 * Odometry's.
 *
 * Odometry indirects through a garage so a household can share a fleet.
 * Coinbox must not reuse that: adding someone to your garage so they can see
 * service schedules must never expose your salary. There is no
 * ledger_members table, so no membership can be granted at all -- sharing is
 * unrepresentable rather than merely absent.
 *
 * `users` is shared with Odometry, so a person who has used the fleet portal
 * already has a row here. Bootstrapping must therefore cope with "user
 * exists, ledger does not", not just with a wholly new person.
 */

const SELECT_SCOPE = `
  SELECT u.id        AS user_id,
         u.timezone  AS timezone,
         l.id        AS ledger_id,
         s.currency  AS currency
    FROM users u
    JOIN ledgers l ON l.owner_user_id = u.id
    LEFT JOIN user_settings s ON s.user_id = u.id
   WHERE u.email = ?
   LIMIT 1`;

interface ScopeRow {
  user_id: string;
  timezone: string;
  ledger_id: string;
  currency: string | null;
}

function toScope(row: ScopeRow): Scope {
  return {
    userId: row.user_id,
    ledgerId: row.ledger_id,
    timezone: row.timezone,
    // The LEFT JOIN yields NULL for a user with no settings row, which is the
    // normal state for someone who reached Coinbox before Odometry.
    currency: row.currency ?? "MYR",
  };
}

export async function resolveLedgerScope(env: Env, user: AuthUser): Promise<Scope> {
  const existing = await env.DB.prepare(SELECT_SCOPE).bind(user.email).first<ScopeRow>();
  if (existing) return toScope(existing);
  return bootstrapLedger(env, user);
}

async function bootstrapLedger(env: Env, user: AuthUser): Promise<Scope> {
  const createdAt = nowIso();

  // D1 has no interactive transactions. batch() is atomic: either every
  // statement lands or none does, so a half-created user cannot exist.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`,
    ).bind(crypto.randomUUID(), user.email, user.name, createdAt),

    // The ledger's owner is read back out of `users` rather than bound from a
    // variable. If two first requests race, one loses the user insert, and a
    // bound id would then reference a row that was never written -- a foreign
    // key violation on a brand new account. Selecting the winner cannot miss.
    env.DB.prepare(
      `INSERT INTO ledgers (id, owner_user_id, name, created_at)
       SELECT ?, u.id, ?, ? FROM users u WHERE u.email = ?
       ON CONFLICT(owner_user_id) DO NOTHING`,
    ).bind(crypto.randomUUID(), "My Ledger", createdAt, user.email),

    env.DB.prepare(
      `INSERT INTO user_settings (user_id) SELECT u.id FROM users u WHERE u.email = ?
       ON CONFLICT(user_id) DO NOTHING`,
    ).bind(user.email),
  ]);

  // Re-read rather than construct: whichever concurrent request won, this
  // returns what is actually in the database.
  const row = await env.DB.prepare(SELECT_SCOPE).bind(user.email).first<ScopeRow>();
  if (!row) throw new UnauthorizedError("Could not establish a ledger");
  return toScope(row);
}
