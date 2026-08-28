import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../index";
import { transactionCreate, transactionPatch, direction } from "@shared/zod";

/**
 * Query parameters are parsed, not read.
 *
 * An unrecognised `direction` must not reach the WHERE clause and quietly
 * return an empty ledger -- the same reasoning as Odometry's vehicleType
 * parsing. `.optional()` throughout, because every filter is.
 */
const listQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")
    .optional(),
  categoryId: z.string().min(1).optional(),
  direction: direction.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

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

  // --- reference data for the entry form ---

  /** Global seed categories plus any this ledger has defined. */
  app.get("/api/categories", async (c) => c.json(await c.get("repos").categories.list()));

  /**
   * Vehicles the caller may attach a transaction to.
   *
   * Scoped by GARAGE MEMBERSHIP, not by ledger -- vehicles are Odometry's.
   * A garage co-member seeing the owner's cars here is the intended
   * behaviour; see VehicleRepo. The isolation suite asserts that the same
   * person still cannot see the owner's transactions.
   */
  app.get("/api/vehicles", async (c) => c.json(await c.get("repos").vehicles.list()));

  // --- the ledger ---

  app.get("/api/transactions", async (c) => {
    const filters = listQuery.parse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    return c.json(await c.get("repos").transactions.list(filters));
  });

  app.get("/api/transactions/:id", async (c) =>
    c.json(await c.get("repos").transactions.get(c.req.param("id"))),
  );

  /**
   * Rollups, straight from v_txn_monthly. Invariant 4 -- aggregation is SQL,
   * never a loop in the Worker. With `?month=` it breaks down by category;
   * without, it is one row per month.
   */
  app.get("/api/summary", async (c) => {
    const { month } = listQuery.pick({ month: true }).parse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    return c.json(await c.get("repos").transactions.monthlySummary(month));
  });

  app.post("/api/transactions", async (c) => {
    const input = transactionCreate.parse(await c.req.json());
    return c.json(await c.get("repos").transactions.create(input), 201);
  });

  /**
   * Editing a past entry -- the first of the four things spec 1.1 says the
   * Google Form cannot do.
   *
   * transactionPatch is `.strict()` and omits the import-provenance columns,
   * so an edit cannot rewrite what the Sheet originally said. That evidence is
   * the only record of which rows were corrected on the way in.
   */
  app.patch("/api/transactions/:id", async (c) => {
    const patch = transactionPatch.parse(await c.req.json());
    return c.json(await c.get("repos").transactions.update(c.req.param("id"), patch));
  });
}

/**
 * NOTE: there is no assertCanWrite() here, unlike Odometry.
 *
 * Odometry has roles because a garage is shared -- a viewer must not log a
 * service. A ledger is never shared: there is no ledger_members table, so
 * anyone who resolves to a ledger owns it outright. Adding a role check would
 * imply a sharing model that deliberately does not exist.
 */
