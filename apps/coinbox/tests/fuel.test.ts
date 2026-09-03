import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { as, addToGarageOf, giveGarage, giveLedger, giveVehicle, migrate, resetDb } from "./helpers";
import { makeRepos } from "@worker/data";

/**
 * THE CROSS-PORTAL WRITE.
 *
 * A fill-up is the only write in this portal that reaches into Odometry. These
 * tests exist because every failure mode here is silent: a fill that lands
 * without its money, money that lands without its odometer, or an odometer
 * stamped with the wrong garage all look like success from the client.
 */

const ALICE = "alice@test.com";
const BOB = "bob@test.com";
const CAROL = "carol@test.com";

async function seedAlice(): Promise<{ ledgerId: string; vehicleId: string }> {
  const ledgerId = await giveLedger(ALICE);
  await giveGarage(ALICE);
  const vehicleId = await giveVehicle(ALICE, "Waja");
  return { ledgerId, vehicleId };
}

function fillBody(vehicleId: string | null, over: Record<string, unknown> = {}) {
  return {
    occurredOn: "2026-09-01",
    item: "Car fuel",
    categoryId: "cat_transportation",
    vehicleId,
    amountSen: 9_000,
    direction: "out",
    fuel: { odometerKm: 50_000, litresMilli: 43_902, isFullTank: true },
    ...over,
  };
}

async function counts() {
  const one = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? -1;
  return {
    transactions: await one("SELECT COUNT(*) AS n FROM transactions"),
    readings: await one("SELECT COUNT(*) AS n FROM odometer_readings"),
    fills: await one("SELECT COUNT(*) AS n FROM fuel_fills"),
  };
}

beforeAll(migrate);
beforeEach(resetDb);

describe("a fill-up writes into both portals", () => {
  it("records the entry, the reading and the fill", async () => {
    const { vehicleId } = await seedAlice();

    const res = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId),
    });
    expect(res.status).toBe(201);

    expect(await counts()).toEqual({ transactions: 1, readings: 1, fills: 1 });

    const fill = await env.DB.prepare(
      `SELECT f.litres_milli, f.is_full_tank, f.filled_on, f.transaction_id,
              r.reading_km, r.source, r.garage_id AS reading_garage,
              f.garage_id AS fill_garage, v.garage_id AS vehicle_garage
         FROM fuel_fills f
         JOIN odometer_readings r ON r.id = f.odometer_reading_id
         JOIN vehicles v ON v.id = f.vehicle_id`,
    ).first<Record<string, unknown>>();

    expect(fill?.litres_milli).toBe(43_902);
    expect(fill?.is_full_tank).toBe(1);
    expect(fill?.filled_on).toBe("2026-09-01");
    expect(fill?.reading_km).toBe(50_000);
    expect(fill?.source).toBe("manual");
    expect(fill?.transaction_id).toBe(res.body.id);

    // The garage came off the vehicle row, not from anything the caller sent.
    expect(fill?.fill_garage).toBe(fill?.vehicle_garage);
    expect(fill?.reading_garage).toBe(fill?.vehicle_garage);
  });

  it("refreshes the cached odometer on the vehicle", async () => {
    const { vehicleId } = await seedAlice();
    await as(ALICE)("/api/transactions", { method: "POST", json: fillBody(vehicleId) });

    const v = await env.DB.prepare(
      `SELECT current_odometer_km, odometer_updated_on FROM vehicles WHERE id = ?`,
    )
      .bind(vehicleId)
      .first<{ current_odometer_km: number; odometer_updated_on: string }>();

    expect(v?.current_odometer_km).toBe(50_000);
    expect(v?.odometer_updated_on).toBe("2026-09-01");
  });

  it("leaves an entry with no fuel block completely unchanged", async () => {
    const { vehicleId } = await seedAlice();
    const body = fillBody(vehicleId);
    delete (body as Record<string, unknown>).fuel;

    const res = await as(ALICE)("/api/transactions", { method: "POST", json: body });
    expect(res.status).toBe(201);
    expect(await counts()).toEqual({ transactions: 1, readings: 0, fills: 0 });
  });

  /**
   * The backdating rule, reached from the Coinbox side. Entering a forgotten
   * fill from July must not drag today's odometer backwards: the reading is
   * recorded, the cache is left alone.
   */
  it("records a backdated fill without moving the current odometer", async () => {
    const { vehicleId } = await seedAlice();

    await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId, { occurredOn: "2026-09-01" }),
    });
    await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId, {
        occurredOn: "2026-07-01",
        fuel: { odometerKm: 47_000, litresMilli: 40_000, isFullTank: true },
      }),
    });

    const v = await env.DB.prepare(
      `SELECT current_odometer_km, odometer_updated_on FROM vehicles WHERE id = ?`,
    )
      .bind(vehicleId)
      .first<{ current_odometer_km: number; odometer_updated_on: string }>();

    expect(v?.current_odometer_km).toBe(50_000);
    expect(v?.odometer_updated_on).toBe("2026-09-01");

    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM odometer_readings`).first<{
      n: number;
    }>();
    expect(n?.n).toBe(2);
  });
});

describe("a rejected fill writes nothing at all", () => {
  /**
   * THE ATOMICITY GUARANTEE. Every case here must leave the database exactly as
   * it found it: no orphan transaction, no orphan reading, no orphan fill.
   * Money without its litres, or an odometer that moved for an entry that does
   * not exist, are both worse than a plain failure.
   */
  it("rejects an odometer lower than an earlier reading, and rolls back", async () => {
    const { vehicleId } = await seedAlice();

    await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId, { occurredOn: "2026-07-01" }),
    });

    const res = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId, {
        occurredOn: "2026-09-01",
        fuel: { odometerKm: 5_000, litresMilli: 40_000, isFullTank: true },
      }),
    });

    expect(res.status).toBe(422);
    expect(res.text).toMatch(/lower than an earlier reading/);
    expect(await counts()).toEqual({ transactions: 1, readings: 1, fills: 1 });
  });

  it("rejects a fill against someone else's vehicle, and rolls back", async () => {
    await giveLedger(BOB);
    await giveGarage(BOB);
    const bobsCar = await giveVehicle(BOB, "BOB_CIVIC");

    await giveLedger(ALICE);
    await giveGarage(ALICE);

    const res = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(bobsCar),
    });

    expect(res.status).toBe(404);
    expect(await counts()).toEqual({ transactions: 0, readings: 0, fills: 0 });
  });

  it("rejects a fill with no vehicle", async () => {
    await seedAlice();
    const res = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(null),
    });

    expect(res.status).toBe(422);
    expect(await counts()).toEqual({ transactions: 0, readings: 0, fills: 0 });
  });

  it("rejects zero litres", async () => {
    const { vehicleId } = await seedAlice();
    const res = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId, {
        fuel: { odometerKm: 50_000, litresMilli: 0, isFullTank: true },
      }),
    });

    expect(res.status).toBe(422);
    expect(await counts()).toEqual({ transactions: 0, readings: 0, fills: 0 });
  });

  /**
   * `isFullTank` has no default in the schema on purpose: "we do not know" and
   * "it was full" must not collapse into one stored value, because consumption
   * is only computable full tank to full tank.
   */
  it("rejects a fill that does not say whether the tank was filled", async () => {
    const { vehicleId } = await seedAlice();
    const res = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId, {
        fuel: { odometerKm: 50_000, litresMilli: 43_902 },
      }),
    });

    expect(res.status).toBe(422);
    expect(await counts()).toEqual({ transactions: 0, readings: 0, fills: 0 });
  });
});

describe("the write is one batch", () => {
  /**
   * THE MID-WRITE FAILURE, which the tests above cannot reach.
   *
   * Every rejection above happens BEFORE any statement runs -- Zod, the
   * category check, the vehicle check, the odometer check -- so they would all
   * still pass if create() wrote the transaction and the fill in two separate
   * batches. What they do not cover is a statement failing part way through,
   * which is the case the single batch() actually exists for.
   *
   * So this one goes through the repository directly, under the ledger scope
   * the middleware would have built, with litres the database will refuse. The
   * transaction insert succeeds and the fill insert violates
   * CHECK (litres_milli > 0); if those are not in one batch, the entry survives
   * with no fill and no litres, which is money whose reason has vanished.
   */
  it("rolls the transaction back when a later statement fails", async () => {
    const { ledgerId, vehicleId } = await seedAlice();
    const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
      .bind(ALICE)
      .first<{ id: string }>();

    const repos = makeRepos(env as never, {
      userId: user!.id,
      ledgerId,
      timezone: "Asia/Kuala_Lumpur",
      currency: "MYR",
    });

    // Bypasses Zod deliberately: the point is what the DATABASE refuses, and
    // the boundary already proves it never gets this far from a client.
    const poisoned = {
      ...fillBody(vehicleId),
      fuel: { odometerKm: 50_000, litresMilli: -5, isFullTank: true },
    } as never;

    await expect(repos.transactions.create(poisoned)).rejects.toThrow();
    expect(await counts()).toEqual({ transactions: 0, readings: 0, fills: 0 });
  });
});

describe("editing and deleting", () => {
  /**
   * `fuel` is absent from transactionPatch, which is .strict(). Odometer
   * readings have no correction path in Odometry either, so this is consistent
   * with what already exists rather than a new gap.
   */
  it("refuses a fuel block in a PATCH", async () => {
    const { vehicleId } = await seedAlice();
    const created = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId),
    });

    const res = await as(ALICE)(`/api/transactions/${created.body.id}`, {
      method: "PATCH",
      json: { fuel: { odometerKm: 51_000, litresMilli: 40_000, isFullTank: true } },
    });

    expect(res.status).toBe(422);
  });

  /**
   * Deleting the money drops the fill and KEEPS the reading. The car really was
   * at that mileage on that day: a physical observation, not a money fact.
   */
  it("drops the fill but keeps the odometer reading", async () => {
    const { vehicleId } = await seedAlice();
    const created = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId),
    });

    const res = await as(ALICE)(`/api/transactions/${created.body.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    expect(await counts()).toEqual({ transactions: 0, readings: 1, fills: 0 });
  });
});

describe("a garage co-member", () => {
  /**
   * A household co-owns a fleet, so Carol filling the shared car is a
   * legitimate update to that car's odometer. Her spending stays entirely in
   * her own ledger, which is the case the two-axis design exists to guarantee.
   */
  it("may fill a shared vehicle, into the owner's garage and their own ledger", async () => {
    const { vehicleId } = await seedAlice();
    const carolLedger = await giveLedger(CAROL);

    /**
     * CAROL HAS HER OWN GARAGE TOO, and that is the point of this fixture.
     *
     * Without it she belongs to exactly one garage, Alice's, so "the vehicle's
     * garage" and "the caller's garage" are the same string and the test passes
     * whichever one the code actually used. Two garages is what makes the
     * question answerable -- and it is the realistic shape anyway, two people
     * who each have a garage and share one car.
     */
    await giveGarage(CAROL);
    await addToGarageOf(ALICE, CAROL);

    const carolsOwnGarage = await env.DB.prepare(
      `SELECT g.id AS id FROM garages g JOIN users u ON u.id = g.created_by WHERE u.email = ?`,
    )
      .bind(CAROL)
      .first<{ id: string }>();

    const res = await as(CAROL)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId, { item: "CAROL_SECRET_FUEL" }),
    });
    expect(res.status).toBe(201);

    const row = await env.DB.prepare(
      `SELECT t.ledger_id, f.garage_id AS fill_garage, v.garage_id AS vehicle_garage,
              r.garage_id AS reading_garage
         FROM fuel_fills f
         JOIN transactions t ON t.id = f.transaction_id
         JOIN vehicles v ON v.id = f.vehicle_id
         JOIN odometer_readings r ON r.id = f.odometer_reading_id`,
    ).first<Record<string, unknown>>();

    expect(row?.ledger_id).toBe(carolLedger);
    // The vehicle's garage, NOT the caller's own.
    expect(row?.fill_garage).toBe(row?.vehicle_garage);
    expect(row?.reading_garage).toBe(row?.vehicle_garage);
    expect(row?.fill_garage).not.toBe(carolsOwnGarage?.id);

    // Alice sees the car's new mileage; she never sees Carol's entry.
    const alicesLedger = await as(ALICE)("/api/transactions");
    expect(alicesLedger.text).not.toContain("CAROL_SECRET_FUEL");

    const v = await env.DB.prepare(`SELECT current_odometer_km FROM vehicles WHERE id = ?`)
      .bind(vehicleId)
      .first<{ current_odometer_km: number }>();
    expect(v?.current_odometer_km).toBe(50_000);
  });

  it("cannot fill a vehicle once removed from the garage", async () => {
    const { vehicleId } = await seedAlice();
    await giveLedger(CAROL);
    await addToGarageOf(ALICE, CAROL);
    await env.DB.prepare(
      `DELETE FROM garage_members WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
    )
      .bind(CAROL)
      .run();

    const res = await as(CAROL)("/api/transactions", {
      method: "POST",
      json: fillBody(vehicleId),
    });

    expect(res.status).toBe(404);
    expect(await counts()).toEqual({ transactions: 0, readings: 0, fills: 0 });
  });
});
