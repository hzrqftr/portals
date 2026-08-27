import type { CoreEnv } from "@portals/core/worker";

export interface Env extends CoreEnv {
  ASSETS: Fetcher;
}

/**
 * Resolved once per request and handed to every repository. Nothing reaches
 * the database without one.
 *
 * Note what is NOT here: no garageId, and no role. Coinbox's ownership axis
 * is the ledger and only the ledger. A garage membership must never widen
 * what this scope can see -- if a garageId appeared on this object, someone
 * would eventually filter by it.
 */
export interface Scope {
  userId: string;
  ledgerId: string;
  /** For "today" on the user's wall calendar. Invariant 5. */
  timezone: string;
  currency: string;
}
