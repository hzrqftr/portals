import { todayIn } from "@portals/core";
import { makeDb } from "./base";
import { RecurringRepo } from "./recurring";
import type { Scope } from "../types";

/**
 * The nightly job that posts due recurring entries.
 *
 * ===========================================================================
 * WHY THIS IS NOT A SECOND, UNSCOPED WRITE PATH
 * ===========================================================================
 *
 * Every other write in this portal is built on a `Scope` resolved from
 * Cloudflare Access. A cron has no request and no user, which is the same
 * problem `packages/core/src/worker/backup.ts` faced -- and its comment is
 * emphatic that widening `BaseScopedRepo` to allow an unscoped read is the
 * wrong answer, because it puts that hole in the path of every repository in
 * both portals to serve one caller. It is a stronger argument here: unlike a
 * backup, this WRITES.
 *
 * So it is not widened. This file runs exactly one unscoped statement -- a
 * roster of "which ledgers have work, and in whose timezone" -- and then
 * constructs a real `Scope` per ledger and goes back through the ordinary
 * `LedgerScopedRepo`. Every INSERT carries the tenant predicate's value. The
 * roster selects ids and a timezone: no money, no item text, so even a bug in
 * it could leak nothing.
 *
 * It lives in `data/` because that is the one directory where `env.DB` may be
 * dereferenced. No allow-list in `scripts/check-db-imports.mjs` was widened to
 * land this -- those regexes silently stopped matching once before, and the
 * lint reported success while enforcing nothing.
 *
 * It is NOT in `packages/core/src/worker/` either. `backup.ts` sits there
 * because it is table-agnostic and serves both portals; this is Coinbox domain
 * logic -- categories, direction, ledger scoping -- and moving it to core would
 * let Odometry import Coinbox's business rules for no benefit.
 *
 * This is the only place a `Scope` is built outside `scope.ts`. A ledger has
 * exactly one owner (`ledgers.owner_user_id` is unique, enforced by
 * bootstrapLedger's ON CONFLICT), so "the ledger's owner" is a total function
 * and the Scope is well defined rather than invented.
 */

/**
 * Only ledgers with something to do. Selecting every ledger and finding no
 * rules would be correct but would grow with the user base rather than with
 * the work.
 */
const LEDGERS_WITH_RULES = `
  SELECT l.id                        AS ledger_id,
         l.owner_user_id             AS owner_user_id,
         u.timezone                  AS timezone,
         COALESCE(s.currency, 'MYR') AS currency
    FROM ledgers l
    JOIN users u ON u.id = l.owner_user_id
    LEFT JOIN user_settings s ON s.user_id = u.id
   WHERE EXISTS (
           SELECT 1 FROM recurring_rules r
            WHERE r.ledger_id = l.id AND r.is_active = 1
         )`;

interface LedgerRow {
  ledger_id: string;
  owner_user_id: string;
  timezone: string;
  currency: string;
}

export interface RunResult {
  ledgers: number;
  considered: number;
  posted: number;
  skipped: number;
}

export async function runRecurringPosting(
  env: { DB: D1Database },
  options: { now?: Date } = {},
): Promise<RunResult> {
  const now = options.now ?? new Date();
  const { results } = await env.DB.prepare(LEDGERS_WITH_RULES).all<LedgerRow>();
  const { db, raw } = makeDb(env);

  const total: RunResult = { ledgers: results.length, considered: 0, posted: 0, skipped: 0 };

  for (const row of results) {
    // PER LEDGER, never once for the whole run.
    //
    // The Worker fires at a fixed UTC instant but "today" belongs to the
    // owner. At UTC+8 a single global today is the previous local day for
    // eight hours out of every twenty-four, and an entry posted a day early is
    // precisely the quiet wrongness the fleet spec warns destroys trust.
    //
    // Because the gate is `occurrence <= today`, this job can be LATE by at
    // most one run and can never be EARLY, in any timezone, whenever it fires.
    const today = todayIn(row.timezone, now);

    const scope: Scope = {
      userId: row.owner_user_id,
      ledgerId: row.ledger_id,
      timezone: row.timezone,
      currency: row.currency,
    };

    const result = await new RecurringRepo(db, raw, scope).postDue(today);
    total.considered += result.considered;
    total.posted += result.posted;
    total.skipped += result.skipped;
  }

  return total;
}
