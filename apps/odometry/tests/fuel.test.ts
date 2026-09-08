import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { weightedLPer100km } from "@portals/core";
import { as, migrate, resetDb } from "./helpers";

/**
 * CONSUMPTION ARITHMETIC.
 *
 * Every number here is checkable by hand, on purpose: a consumption figure that
 * is wrong by a factor of ten is obvious, and one that is wrong by fifteen
 * percent is not. The cases that matter are the ones where the naive
 * implementation gives a plausible answer -- a partial fill, a first fill, and
 * integer division.
 */

const OWNER = "owner@test.com";

async function bootstrap(): Promise<string> {
  // Any request bootstraps the user, their garage and their membership.
  await as(OWNER)("/api/me");
  const res = await as(OWNER)("/api/vehicles", {
    method: "POST",
    json: { nickname: "Waja", vehicleType: "car", fuelType: "petrol" },
  });
  return res.body.id as string;
}

/**
 * Seeds a fill by raw SQL, the way the rest of this suite seeds fixtures.
 *
 * There is no POST for a fill in this portal -- fills are created from Coinbox,
 * where the litres and the ringgit are keyed in together. Going through that
 * app's API from here would be testing the wrong Worker.
 */
async function giveFill(
  vehicleId: string,
  filledOn: string,
  readingKm: number,
  litres: number,
  isFullTank = true,
): Promise<void> {
  const readingId = crypto.randomUUID();
  const garage = await env.DB.prepare(`SELECT garage_id AS g FROM vehicles WHERE id = ?`)
    .bind(vehicleId)
    .first<{ g: string }>();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO odometer_readings (id, garage_id, vehicle_id, reading_km, recorded_on, source)
       VALUES (?,?,?,?,?,'manual')`,
    ).bind(readingId, garage!.g, vehicleId, readingKm, filledOn),
    env.DB.prepare(
      `INSERT INTO fuel_fills
         (id, garage_id, vehicle_id, odometer_reading_id, filled_on, litres_milli,
          is_full_tank, transaction_id, created_at)
       VALUES (?,?,?,?,?,?,?,NULL,'2026-09-01T00:00:00.000Z')`,
    ).bind(
      crypto.randomUUID(),
      garage!.g,
      vehicleId,
      readingId,
      filledOn,
      Math.round(litres * 1000),
      isFullTank ? 1 : 0,
    ),
  ]);
}

beforeAll(migrate);
beforeEach(resetDb);

describe("consumption between full fills", () => {
  /**
   * The baseline case. 40 litres over 500 km is 8.0 L/100km and 12.5 km/L,
   * both of which you can check without a calculator.
   */
  it("computes the segment closed by the second full fill", async () => {
    const v = await bootstrap();
    await giveFill(v, "2026-09-01", 50_000, 40);
    await giveFill(v, "2026-09-10", 50_500, 40);

    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const [latest, first] = res.body;
    expect(latest.readingKm).toBe(50_500);
    expect(latest.distanceKm).toBe(500);
    expect(latest.segmentLitresMilli).toBe(40_000);
    expect(latest.lPer100km).toBeCloseTo(8.0, 6);
    expect(latest.kmPerLitre).toBeCloseTo(12.5, 6);

    // The FIRST fill closes nothing. That is a real answer, not missing data --
    // the same shape as a vehicle with no service history being `unknown`
    // rather than `overdue`.
    expect(first.readingKm).toBe(50_000);
    expect(first.distanceKm).toBeNull();
    expect(first.lPer100km).toBeNull();
  });

  /**
   * THE CASE THAT MAKES is_full_tank LOAD-BEARING.
   *
   * A 10 L splash at 50,200 then a 40 L fill at 50,500. The segment is the
   * whole 500 km and ALL 50 litres -- 10.0 L/100km.
   *
   * Get this wrong by dividing the 40 L fill by the 300 km since the splash and
   * you get 13.3, which is a number you would believe. Get it wrong by dropping
   * the partial fill entirely and you get 8.0, which is also a number you would
   * believe. Neither is right, and nothing on screen could tell you.
   */
  it("carries a partial fill into the segment it belongs to", async () => {
    const v = await bootstrap();
    await giveFill(v, "2026-09-01", 50_000, 40, true);
    await giveFill(v, "2026-09-05", 50_200, 10, false);
    await giveFill(v, "2026-09-10", 50_500, 40, true);

    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    const latest = res.body[0];

    expect(latest.readingKm).toBe(50_500);
    expect(latest.distanceKm).toBe(500);
    expect(latest.segmentLitresMilli).toBe(50_000);
    expect(latest.lPer100km).toBeCloseTo(10.0, 6);
  });

  it("gives a partial fill no consumption figure of its own", async () => {
    const v = await bootstrap();
    await giveFill(v, "2026-09-01", 50_000, 40, true);
    await giveFill(v, "2026-09-05", 50_200, 10, false);

    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    const partial = res.body.find((r: { readingKm: number }) => r.readingKm === 50_200);

    expect(partial.isFullTank).toBe(0);
    expect(partial.distanceKm).toBeNull();
    expect(partial.lPer100km).toBeNull();
  });

  /**
   * SQLite truncates integer division. Without the `* 1.0` this segment would
   * compute as 0 rather than 6.25, and then divide by zero downstream -- the
   * same trap status.ts documents for the usage rate.
   */
  it("does not truncate a fractional result to zero", async () => {
    const v = await bootstrap();
    await giveFill(v, "2026-09-01", 50_000, 40);
    await giveFill(v, "2026-09-10", 50_800, 50);

    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    expect(res.body[0].lPer100km).toBeCloseTo(6.25, 6);
  });

  /** Two fills at one odometer is a real data-entry outcome, not an impossible one. */
  it("does not divide by zero when two fills share an odometer", async () => {
    const v = await bootstrap();
    await giveFill(v, "2026-09-01", 50_000, 40);
    await giveFill(v, "2026-09-01", 50_000, 5);

    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    expect(res.status).toBe(200);
    for (const row of res.body) {
      expect(row.lPer100km === null || Number.isFinite(row.lPer100km)).toBe(true);
    }
  });

  /**
   * Backdated entry is expected, so the segments are built on the ODOMETER
   * axis, not the date the row happened to be typed on.
   */
  it("orders segments by odometer, not by entry order", async () => {
    const v = await bootstrap();
    await giveFill(v, "2026-09-10", 50_500, 40);
    await giveFill(v, "2026-09-01", 50_000, 40);

    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    expect(res.body[0].readingKm).toBe(50_500);
    expect(res.body[0].distanceKm).toBe(500);
    expect(res.body[1].distanceKm).toBeNull();
  });

  it("returns an empty list for a vehicle with no fills", async () => {
    const v = await bootstrap();
    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  /**
   * fuel_fills is garage-scoped and a garage is shared, so anything priced here
   * would be readable by every co-member. The ringgit stays in Coinbox.
   */
  it("carries no money", async () => {
    const v = await bootstrap();
    await giveFill(v, "2026-09-01", 50_000, 40);

    const res = await as(OWNER)(`/api/vehicles/${v}/fuel`);
    expect(res.text).not.toMatch(/sen|cost|amount|price/i);
  });
});

/**
 * The average shown on the Fuel tab.
 *
 * It is the shared helper in @portals/core, not a local reduce, because
 * Coinbox's fuel drill-down prints the same average for the same car. Two
 * implementations of one figure is two plausible numbers with nothing on
 * either screen able to say which is right.
 */
describe("weightedLPer100km", () => {
  it("weights by distance, not by segment count", () => {
    // 500 km on 40 L is 8.0; 50 km on 5 L is 10.0. The unweighted mean is 9.0.
    const rows = [
      { distanceKm: 500, segmentLitresMilli: 40_000 },
      { distanceKm: 50, segmentLitresMilli: 5_000 },
    ];
    expect(weightedLPer100km(rows)).toBeCloseTo(8.1818, 3);
    expect(weightedLPer100km(rows)).not.toBeCloseTo(9.0, 1);
  });

  it("ignores fills that close no segment", () => {
    expect(
      weightedLPer100km([
        { distanceKm: null, segmentLitresMilli: null },
        { distanceKm: 500, segmentLitresMilli: 40_000 },
      ]),
    ).toBeCloseTo(8.0, 6);
  });

  it("is null with nothing measured, rather than zero", () => {
    // Zero would render as a car that uses no fuel.
    expect(weightedLPer100km([])).toBeNull();
    expect(weightedLPer100km([{ distanceKm: null, segmentLitresMilli: null }])).toBeNull();
  });

  it("skips a zero-distance segment rather than dividing by it", () => {
    // Two fills at one odometer is a real data-entry outcome, not an
    // impossible one -- and Infinity would propagate into the km/L beside it.
    expect(
      weightedLPer100km([
        { distanceKm: 0, segmentLitresMilli: 5_000 },
        { distanceKm: 500, segmentLitresMilli: 40_000 },
      ]),
    ).toBeCloseTo(8.0, 6);
  });
});
