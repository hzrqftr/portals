import type { Hono } from "hono";
import type { AppContext } from "../index";

/**
 * Route handlers. Nothing in this file imports env.DB, the Drizzle client, or
 * Cloudflare Access -- and scripts/check-db-imports.mjs fails the build if
 * that ever changes.
 *
 * Handlers do four things, in order: assert the caller may write, parse the
 * body with a Zod schema shared with the client, call exactly one repository
 * method, and return. No try/catch -- everything propagates to onError.
 */
export function registerRoutes(app: Hono<AppContext>): void {
  // --- identity ---

  /**
   * Who am I, and which ledger am I looking at.
   *
   * `ledgerId` is returned so the isolation suite can assert that two people
   * who share a garage still resolve to different ledgers -- the guarantee
   * this whole portal is arranged around. It is not secret: it is the
   * caller's own id, and knowing it grants nothing.
   */
  app.get("/api/me", (c) => {
    const scope = c.get("scope");
    return c.json({
      userId: scope.userId,
      ledgerId: scope.ledgerId,
      timezone: scope.timezone,
      currency: scope.currency,
    });
  });
}
