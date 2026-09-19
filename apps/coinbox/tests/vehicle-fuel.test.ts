import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, giveGarage, giveLedger, giveVehicle, migrate, resetDb } from "./helpers";

/**
 * The arithmetic behind the fuel drill-down.
 *
 * Every number here is wrong in a plausible way when it is wrong -- 8 L/100km
 * and 9 L/100km are both entirely believable for a small car, so nothing on
 * screen can flag the bad one. That is what these tests are for. The isolation
 * suite covers who may see the figures; this file covers whether they are true.
 */

const ALICE = "alice@test.com";

/** 2026-09-08 is "today" in the suite's world; keep fills inside the window. */
async function seed(): Promise<string> {
  await giveLedger(ALICE);
  await giveGarage(ALICE);
  return giveVehicle(ALICE, "City");
}

/** Logs a fill-up through the real write path, money and litres together. */
async function fill(
  vehicleId: string,
  occurredOn: string,
  odometerKm: number,
  litres: number,
  amountSen: number,
  isFullTank = true,
) {
  const res = await as(ALICE)("/api/transactions", {
    method: "POST",
    json: {
      occurredOn,
      item: "Car fuel",
      categoryId: "cat_transportation",
      vehicleId,
      amountSen,
      direction: "out",
      fuel: { odometerKm, litresMilli: Math.round(litres * 1000), isFullTank },
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function load(vehicleId: string) {
  const res = await as(ALICE)(`/api/vehicles/${vehicleId}/fuel`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

beforeAll(migrate);
beforeEach(resetDb);

describe("segments", () => {
  it("gives the first full fill no figure -- there is nothing to measure from", async () => {
    const vehicleId = await seed();
    await fill(vehicleId, "2026-09-01", 10_000, 40, 8_000);

    const { fills, totals } = await load(vehicleId);

    expect(fills).toHaveLength(1);
    expect(fills[0].lPer100km).toBeNull();
    expect(fills[0].distanceKm).toBeNull();
    // One fill, no closed segment. Null, not zero -- a zero would render as a
    // car that uses no fuel.
    expect(totals.measuredCount).toBe(0);
    expect(totals.avgLPer100km).toBeNull();
  });

  it("measures full tank to full tank", async () => {
    const vehicleId = await seed();
    await fill(vehicleId, "2026-09-01", 10_000, 40, 8_000);
    await fill(vehicleId, "2026-09-08", 10_500, 40, 8_000);

    const { fills, totals } = await load(vehicleId);

    // Newest first, by odometer.
    expect(fills[0].readingKm).toBe(10_500);
    expect(fills[0].distanceKm).toBe(500);
    expect(fills[0].lPer100km).toBeCloseTo(8.0, 6);
    expect(fills[0].kmPerLitre).toBeCloseTo(12.5, 6);
    expect(totals.measuredCount).toBe(1);
    expect(totals.avgLPer100km).toBeCloseTo(8.0, 6);
  });

  /**
   * THE REASON `is_full_tank` IS NOT NULL.
   *
   * A partial fill's litres belong to the segment that ends at the next FULL
   * fill, because that fuel was burned over that distance too. Dividing it by
   * its own 200 km would give 5.0 L/100km -- a number in an entirely plausible
   * range that is simply wrong.
   */
  it("carries a partial fill's litres into the next full segment", async () => {
    const vehicleId = await seed();
    await fill(vehicleId, "2026-09-01", 10_000, 40, 8_000);
    await fill(vehicleId, "2026-09-04", 10_200, 10, 2_000, false);
    await fill(vehicleId, "2026-09-08", 10_500, 30, 6_000);

    const { fills, totals } = await load(vehicleId);

    const partial = fills.find((f: { readingKm: number }) => f.readingKm === 10_200);
    expect(partial.isFullTank).toBe(0);
    expect(partial.lPer100km).toBeNull();

    const closing = fills.find((f: { readingKm: number }) => f.readingKm === 10_500);
    expect(closing.distanceKm).toBe(500);
    // 10 from the partial + 30 from this one, not 30.
    expect(closing.segmentLitresMilli).toBe(40_000);
    expect(closing.lPer100km).toBeCloseTo(8.0, 6);

    expect(totals.measuredCount).toBe(1);
    expect(totals.litresMilli).toBe(80_000); // every fill, full or not
  });

  it("survives two fills recorded at the same odometer", async () => {
    const vehicleId = await seed();
    await fill(vehicleId, "2026-09-01", 10_000, 40, 8_000);
    await fill(vehicleId, "2026-09-02", 10_000, 5, 1_000);

    const { fills, totals } = await load(vehicleId);

    // A guard, not a tidy-up: this is a real data-entry outcome, and the
    // division must produce null rather than Infinity.
    const zero = fills.find((f: { distanceKm: number | null }) => f.distanceKm === 0);
    expect(zero.lPer100km).toBeNull();
    expect(totals.avgLPer100km).toBeNull();
  });
});

describe("averages", () => {
  /**
   * The average is DISTANCE-WEIGHTED, not the mean of the per-segment rates.
   *
   * These numbers are chosen so the two disagree by a full litre: a 500 km
   * segment at 8.0 and a 50 km top-up at 10.0 average to 9.0 unweighted, and
   * to 8.18 weighted. The unweighted figure lets a splash of fuel count as
   * much as a tank, and it is what the old Odometry table showed.
   */
  it("weights consumption by distance, not by segment count", async () => {
    const vehicleId = await seed();
    await fill(vehicleId, "2026-09-01", 10_000, 40, 8_000);
    await fill(vehicleId, "2026-09-05", 10_500, 40, 8_000); // 500 km, 8.0
    await fill(vehicleId, "2026-09-08", 10_550, 5, 1_000); //   50 km, 10.0

    const { fills, totals } = await load(vehicleId);

    const rates = fills
      .map((f: { lPer100km: number | null }) => f.lPer100km)
      .filter((r: number | null): r is number => r !== null);
    expect(rates).toHaveLength(2);

    const unweighted = rates.reduce((a: number, b: number) => a + b, 0) / rates.length;
    expect(unweighted).toBeCloseTo(9.0, 6);

    // 45 litres over 550 km.
    expect(totals.avgLPer100km).toBeCloseTo(8.1818, 3);
    expect(totals.avgLPer100km).not.toBeCloseTo(unweighted, 2);
    expect(totals.segmentDistanceKm).toBe(550);
    expect(totals.segmentLitresMilli).toBe(45_000);
  });

  it("weights price per litre by volume, and reports the newest separately", async () => {
    const vehicleId = await seed();
    // 40 litres at RM 2.00, then 5 litres at RM 3.00. The volume-weighted mean
    // is 2.11, not the 2.50 a mean of the two prices would give.
    await fill(vehicleId, "2026-09-01", 10_000, 40, 8_000);
    await fill(vehicleId, "2026-09-08", 10_500, 5, 1_500);

    const { totals } = await load(vehicleId);

    expect(totals.avgSenPerLitre).toBe(Math.round(9_500 / 45));
    expect(totals.latestSenPerLitre).toBe(300);
    expect(totals.fuelSpendSen).toBe(9_500);
  });
});

describe("the card agrees with the drill-down", () => {
  /**
   * The card opens the sheet, so its figure and the sheet's headline are meant
   * to be the same number. They come from two queries over the same shared
   * segment SQL, and can only stay equal on purpose.
   */
  it("reports the same consumption the sheet does", async () => {
    const vehicleId = await seed();
    await fill(vehicleId, "2026-08-01", 10_000, 40, 8_000);
    await fill(vehicleId, "2026-08-10", 10_200, 20, 4_000, false);
    await fill(vehicleId, "2026-08-20", 10_600, 25, 5_000);

    const { totals } = await load(vehicleId);
    const dash = await as(ALICE)("/api/dashboard");
    const row = dash.body.consumption.find(
      (v: { vehicleId: string }) => v.vehicleId === vehicleId,
    );

    // The partial fill's 20 L counts toward the 600 km segment: 45 L / 600 km.
    expect(totals.avgLPer100km).toBeCloseTo(7.5, 6);
    expect(row.avgLPer100km).toBeCloseTo(totals.avgLPer100km, 9);
    expect(row.measuredCount).toBe(totals.measuredCount);
    expect(row.segmentDistanceKm).toBe(600);
    expect(row.fillCount).toBe(3);
  });

  it("lists a car with one full tank, but gives it no figure yet", async () => {
    const vehicleId = await seed();
    await fill(vehicleId, "2026-08-01", 10_000, 40, 8_000);

    const dash = await as(ALICE)("/api/dashboard");
    const row = dash.body.consumption.find(
      (v: { vehicleId: string }) => v.vehicleId === vehicleId,
    );
    expect(row.fillCount).toBe(1);
    expect(row.measuredCount).toBe(0);
    expect(row.avgLPer100km).toBeNull();
  });
});

describe("a vehicle with no fills at all", () => {
  it("answers with empty series rather than an error", async () => {
    const vehicleId = await seed();
    await as(ALICE)("/api/transactions", {
      method: "POST",
      json: {
        occurredOn: "2026-09-03",
        item: "Parking",
        categoryId: "cat_transportation",
        vehicleId,
        amountSen: 500,
        direction: "out",
      },
    });

    const { fills, totals } = await load(vehicleId);

    expect(fills).toEqual([]);
    expect(totals.fillCount).toBe(0);
    expect(totals.avgLPer100km).toBeNull();
    expect(totals.latestSenPerLitre).toBeNull();
    // And the card leaves it off entirely: a parking fee is not a fill.
    const dash = await as(ALICE)("/api/dashboard");
    expect(dash.body.consumption).toEqual([]);
  });
});
