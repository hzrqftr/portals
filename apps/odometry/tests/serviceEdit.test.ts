import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb } from "./helpers";

/**
 * Correcting a service after the fact. Spec 8.4.
 *
 * The service odometer exists in three places -- the record's own column, the
 * odometer_readings row the visit wrote, and the vehicle's cached figure --
 * and every failure here is silent. A correction that updates one and not the
 * others leaves the app showing a number no data supports, with nothing on
 * screen able to say which of the three is right.
 *
 * These are also the tests that keep invariant 6 honest. The test for whether
 * something is a derived due date is exactly this: correct the service
 * odometer and see whether the due point moves. It must.
 */

const U = "owner@example.com";
const call = as(U);

/**
 * A vehicle, optionally with a starting odometer.
 *
 * Pass NO odometer for anything asserting on the cached figure. A vehicle
 * created with one gets a baseline reading dated TODAY, and the cache only
 * ever moves forward in time -- so a service backdated to June correctly
 * leaves that baseline in place, and the test would be measuring the fixture
 * rather than the code.
 */
async function makeVehicle(currentOdometerKm?: number) {
  const res = await call("/api/vehicles", {
    method: "POST",
    json: {
      nickname: "Test Car",
      fuelType: "petrol",
      ...(currentOdometerKm === undefined ? {} : { currentOdometerKm }),
    },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** A visit with one oil change, due again in 10,000 km. */
async function logService(
  vehicleId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await call(`/api/vehicles/${vehicleId}/services`, {
    method: "POST",
    json: {
      servicedOn: "2026-02-10",
      odometerKm: 45_000,
      workshopName: "Original workshop",
      items: [
        { partTypeId: "pt_engine_oil", quantityMilli: 4_500, intervalKmOverride: 10_000 },
      ],
      ...overrides,
    },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function readings(vehicleId: string) {
  const { results } = await env.DB.prepare(
    `SELECT reading_km, recorded_on, source FROM odometer_readings
      WHERE vehicle_id = ? ORDER BY recorded_on, rowid`,
  )
    .bind(vehicleId)
    .all<{ reading_km: number; recorded_on: string; source: string }>();
  return results;
}

async function vehicleCache(vehicleId: string) {
  return env.DB.prepare(
    `SELECT current_odometer_km, odometer_updated_on FROM vehicles WHERE id = ?`,
  )
    .bind(vehicleId)
    .first<{ current_odometer_km: number | null; odometer_updated_on: string | null }>();
}

async function dueKm(vehicleId: string): Promise<number | null> {
  const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
  const row = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_engine_oil");
  return row?.due_km ?? null;
}

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await resetDb();
});

describe("editing a service", () => {
  it("moves the due point when the odometer is corrected (invariant 6)", async () => {
    const vehicleId = await makeVehicle(50_000);
    const serviceId = await logService(vehicleId);

    // 45,000 + a 10,000 km interval.
    expect(await dueKm(vehicleId)).toBe(55_000);

    // The owner's actual case: the odometer was keyed in wrong.
    const res = await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 46_500,
        workshopName: "Original workshop",
        items: [
          { partTypeId: "pt_engine_oil", quantityMilli: 4_500, intervalKmOverride: 10_000 },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.odometerKm).toBe(46_500);

    // If this number had not moved, `due_km` was a stored due date all along.
    expect(await dueKm(vehicleId)).toBe(56_500);
  });

  it("corrects the reading the visit wrote instead of appending a second one", async () => {
    const vehicleId = await makeVehicle(50_000);
    const serviceId = await logService(vehicleId);

    // The vehicle was created with an odometer, so it already has one
    // reading; the service added the second.
    const before = await readings(vehicleId);
    expect(before.filter((r) => r.source === "service")).toHaveLength(1);

    await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: { servicedOn: "2026-02-10", odometerKm: 46_500, items: [] },
    });

    const after = await readings(vehicleId);
    expect(after).toHaveLength(before.length);
    const service = after.filter((r) => r.source === "service");
    expect(service).toHaveLength(1);
    // A second reading here would be a kilometre count the car never showed,
    // indistinguishable afterwards from one it did.
    expect(service[0]!.reading_km).toBe(46_500);
  });

  it("moves the reading's date when the service is re-dated", async () => {
    const vehicleId = await makeVehicle(50_000);
    const serviceId = await logService(vehicleId);

    // Later than the original, which is the direction that trips a naive
    // backwards check: the reading being edited is now strictly before its
    // own new date and gets compared against itself.
    const res = await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: { servicedOn: "2026-03-15", odometerKm: 45_000, items: [] },
    });
    expect(res.status).toBe(200);

    const service = (await readings(vehicleId)).filter((r) => r.source === "service");
    expect(service).toHaveLength(1);
    expect(service[0]!.recorded_on).toBe("2026-03-15");
  });

  it("pulls the vehicle's cached odometer back down on a downward correction", async () => {
    // No baseline reading, so the service's is the only one and the cache
    // is unambiguously holding it.
    const vehicleId = await makeVehicle();
    const serviceId = await logService(vehicleId, {
      servicedOn: "2026-06-01",
      odometerKm: 152_000,
    });

    expect((await vehicleCache(vehicleId))?.current_odometer_km).toBe(152_000);

    // 52,000 typed as 152,000: higher than everything before it, so nothing
    // could have caught it at entry. Correcting it is the only remedy.
    await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: { servicedOn: "2026-06-01", odometerKm: 52_000, items: [] },
    });

    // The normal write path only ever moves this figure FORWARD, so this
    // assertion fails unless the cache is genuinely rebuilt from the readings.
    const cache = await vehicleCache(vehicleId);
    expect(cache?.current_odometer_km).toBe(52_000);
    expect(cache?.odometer_updated_on).toBe("2026-06-01");
  });

  it("replaces the line items wholesale rather than merging them", async () => {
    const vehicleId = await makeVehicle(50_000);
    const serviceId = await logService(vehicleId);

    await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        items: [{ partTypeId: "pt_air_filter", quantityMilli: 1_000, brand: "Denso" }],
      },
    });

    const res = await call(`/api/vehicles/${vehicleId}/services`);
    const items = res.body[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].partTypeId).toBe("pt_air_filter");
    expect(items[0].brand).toBe("Denso");
  });

  it("clears a field that the replacement omits", async () => {
    const vehicleId = await makeVehicle(50_000);
    const serviceId = await logService(vehicleId, { notes: "Original note" });

    await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: { servicedOn: "2026-02-10", odometerKm: 45_000, items: [] },
    });

    const res = await call(`/api/vehicles/${vehicleId}/services`);
    expect(res.body[0].notes).toBeNull();
    expect(res.body[0].workshopName).toBeNull();
  });

  it("leaves the vehicle's interval alone when a line item is removed", async () => {
    const vehicleId = await makeVehicle(50_000);
    const serviceId = await logService(vehicleId);

    await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: { servicedOn: "2026-02-10", odometerKm: 45_000, items: [] },
    });

    // Invariant 6: the last service SETS the vehicle's interval, and nothing
    // stores what it was before. Removing the item cannot put back a number
    // that was never kept. This is pinned deliberately -- it looks like a bug
    // and reverting it would mean inventing a value.
    const row = await env.DB.prepare(
      `SELECT interval_km, is_active FROM maintenance_intervals
        WHERE vehicle_id = ? AND part_type_id = 'pt_engine_oil'`,
    )
      .bind(vehicleId)
      .first<{ interval_km: number; is_active: number }>();
    expect(row?.interval_km).toBe(10_000);
    expect(row?.is_active).toBe(1);
  });

  it("rejects a correction that would run the odometer backwards", async () => {
    const vehicleId = await makeVehicle();
    // An earlier visit, so there is a genuine floor to fall below.
    await logService(vehicleId, { servicedOn: "2026-01-05", odometerKm: 40_000, items: [] });
    const later = await logService(vehicleId, {
      servicedOn: "2026-06-01",
      odometerKm: 60_000,
      items: [],
    });

    const res = await call(`/api/services/${later}`, {
      method: "PATCH",
      json: { servicedOn: "2026-06-01", odometerKm: 30_000, items: [] },
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain("do not run backwards");

    // ...and the rejected edit changed nothing. The check runs before the
    // batch, so a failure must leave all three copies as they were.
    const services = await call(`/api/vehicles/${vehicleId}/services`);
    expect(services.body.find((s: { id: string }) => s.id === later).odometerKm).toBe(60_000);
    expect((await vehicleCache(vehicleId))?.current_odometer_km).toBe(60_000);
  });

  it("rejects a part type from another garage on the edit path", async () => {
    const vehicleId = await makeVehicle(50_000);
    const serviceId = await logService(vehicleId);

    const other = as("someone.else@example.com");
    const theirs = await other("/api/part-types", {
      method: "POST",
      json: { name: "THEIR_PART", category: "other" },
    });
    expect(theirs.status).toBe(201);

    // Spec 5.3. An edit is no less of a write than an insert, and it would be
    // easy to check ids on create and forget to on update.
    const res = await call(`/api/services/${serviceId}`, {
      method: "PATCH",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        items: [{ partTypeId: theirs.body.id, quantityMilli: 1_000 }],
      },
    });
    expect(res.status).toBe(404);

    // The rejected edit left the original line item intact -- proving the
    // validation runs before the DELETE, not mid-batch.
    const services = await call(`/api/vehicles/${vehicleId}/services`);
    expect(services.body[0].items).toHaveLength(1);
    expect(services.body[0].items[0].partTypeId).toBe("pt_engine_oil");
  });
});

describe("deleting a service", () => {
  it("removes the reading it wrote and rebuilds the cached odometer", async () => {
    const vehicleId = await makeVehicle();
    const serviceId = await logService(vehicleId, {
      servicedOn: "2026-06-01",
      odometerKm: 90_000,
      items: [],
    });

    expect((await vehicleCache(vehicleId))?.current_odometer_km).toBe(90_000);

    const res = await call(`/api/services/${serviceId}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    // Before migration 0014 the reading survived the delete, leaving the
    // vehicle's odometer propped up by a visit that no longer existed.
    expect((await readings(vehicleId)).filter((r) => r.source === "service")).toHaveLength(0);
    // Back to the "never recorded" state, which is 0 with a NULL date --
    // current_odometer_km is NOT NULL DEFAULT 0, so that pair IS how this app
    // spells "no odometer", not a fallback invented here.
    expect((await vehicleCache(vehicleId))?.current_odometer_km).toBe(0);
    expect((await vehicleCache(vehicleId))?.odometer_updated_on).toBeNull();
  });
});
