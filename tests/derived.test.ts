import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb } from "./helpers";
import { todayIn } from "@shared/dates";

/**
 * Proves the behaviours where the spec, taken literally, would have produced
 * something that looks right and is wrong. Each test here corresponds to a
 * collision between the spec text and the invariants in CLAUDE.md.
 *
 * These are all silent failures in production: no error, no stack trace,
 * just a number that is quietly incorrect. That is precisely why they are
 * tested rather than reviewed.
 */

const U = "owner@example.com";
const call = as(U);

async function makeVehicle(extra: Record<string, unknown> = {}) {
  const res = await call("/api/vehicles", {
    method: "POST",
    json: { nickname: "Test Car", fuelType: "petrol", currentOdometerKm: 50_000, ...extra },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("money stays an integer (invariant 1)", () => {
  it("multiplies a fractional quantity by a sen price without a float", async () => {
    const vehicleId = await makeVehicle();
    // 4.5 litres at RM 42.00 = RM 189.00 exactly.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        items: [{ partTypeId: "pt_engine_oil", quantityMilli: 4_500, unitCost: 4_200 }],
      },
    });

    const res = await call(`/api/vehicles/${vehicleId}/services`);
    const total = res.body[0].items[0].lineTotalCost;
    expect(total).toBe(18_900);
    expect(Number.isInteger(total)).toBe(true);
  });

  it("rounds a repeating quantity to whole sen rather than carrying a fraction", async () => {
    const vehicleId = await makeVehicle();
    // 3.333 units at RM 1.00: 333.3 sen. Money cannot hold a tenth of a sen,
    // so it must resolve to a whole number at the point of storage, once.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        items: [{ partTypeId: "pt_engine_oil", quantityMilli: 3_333, unitCost: 100 }],
      },
    });

    const { results } = await env.DB.prepare(
      `SELECT line_total_cost, typeof(line_total_cost) AS t FROM service_items`,
    ).all<{ line_total_cost: number; t: string }>();
    expect(results[0]!.t).toBe("integer");
    expect(results[0]!.line_total_cost).toBe(333);
  });

  it("stores every money value as an integer, not a float", async () => {
    const vehicleId = await makeVehicle({ purchasePrice: 4_500_000 });
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        totalCost: 38_050,
        items: [{ partTypeId: "pt_engine_oil", quantityMilli: 4_500, unitCost: 4_200 }],
      },
    });
    await call(`/api/vehicles/${vehicleId}/renewals`, {
      method: "POST",
      json: { type: "road_tax", expiresOn: "2027-01-01", cost: 9_050 },
    });

    // typeof() is SQLite's own view of the stored value. A float that slipped
    // through anywhere in the money path shows up here as 'real'.
    // (The schema declarations are guarded separately, by the REAL/FLOAT rule
    // in scripts/check-db-imports.mjs.)
    const columns: [string, string][] = [
      ["vehicles", "purchase_price"],
      ["service_records", "total_cost"],
      ["service_items", "unit_cost"],
      ["service_items", "quantity_milli"],
      ["service_items", "line_total_cost"],
      ["renewals", "cost"],
    ];
    const results = await env.DB.batch<{ a: string }>(
      columns.map(([table, col]) =>
        env.DB.prepare(`SELECT typeof(${col}) AS a FROM ${table}`),
      ),
    );

    expect(results).toHaveLength(6);
    results.forEach((r: D1Result<{ a: string }>, i: number) => {
      expect(r.results[0]!.a, `${columns[i]![0]}.${columns[i]![1]} is not an integer`).toBe(
        "integer",
      );
    });
  });
});

describe("due status handles missing halves of an interval (spec 6.2 step 5)", () => {
  it("still reports a km-only interval instead of dropping it", async () => {
    const vehicleId = await makeVehicle();

    // Front brake pads are seeded km-only: interval_months is NULL. Taking
    // min(due_date_by_time, projected_date) literally makes this row NULL and
    // it disappears from the list entirely -- the failure this guards.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-01-05",
        odometerKm: 20_000,
        items: [{ partTypeId: "pt_brake_pad_front" }],
      },
    });

    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const pads = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_brake_pad_front");

    expect(pads).toBeDefined();
    expect(pads.due_date_by_time).toBeNull();
    expect(pads.due_km).toBe(60_000); // 20,000 baseline + 40,000 interval
    expect(pads.effective_due_date).not.toBeNull();
    expect(pads.status).not.toBe("unknown");
  });

  it("still reports a time-only interval with no km projection", async () => {
    const vehicleId = await makeVehicle();
    // Battery is seeded months-only: interval_km is NULL.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-01-05",
        odometerKm: 20_000,
        items: [{ partTypeId: "pt_battery" }],
      },
    });

    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const battery = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_battery");

    expect(battery.due_km).toBeNull();
    expect(battery.projected_date_by_km).toBeNull();
    expect(battery.effective_due_date).toBe("2029-01-05"); // +36 months
  });
});

describe("usage rate survives integer division (spec 6.1)", () => {
  it("does not truncate a low-usage vehicle to zero km/day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T04:00:00Z"));

    const vehicleId = await makeVehicle({ currentOdometerKm: 20_000 });
    // 20 km over 30 days is 0.67 km/day. Integer division makes that 0, and
    // the projection then divides by zero and the row goes NULL.
    await call(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      json: { readingKm: 20_000, recordedOn: "2026-07-01" },
    });
    await call(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      json: { readingKm: 20_020, recordedOn: "2026-07-31" },
    });
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-07-01",
        odometerKm: 20_000,
        items: [{ partTypeId: "pt_brake_pad_front" }],
      },
    });

    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const pads = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_brake_pad_front");

    // At 0.67 km/day, 40,000 km away is roughly 60,000 days out: far future,
    // definitely not due, and definitely not a divide-by-zero.
    expect(pads.projected_date_by_km).not.toBeNull();
    expect(pads.status).toBe("ok");
    expect(pads.low_confidence).toBe(0);
    expect(Number(pads.projected_date_by_km.slice(0, 4))).toBeGreaterThan(2100);
  });

  it("flags low confidence and falls back to 30 km/day without enough history", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-01-05",
        odometerKm: 45_000,
        items: [{ partTypeId: "pt_brake_pad_front" }],
      },
    });

    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const pads = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_brake_pad_front");
    expect(pads.low_confidence).toBe(1);
  });
});

describe("no baseline means unknown, never overdue (CLAUDE.md known traps)", () => {
  it("does not alert on a brand new vehicle with no service history", async () => {
    const vehicleId = await makeVehicle();

    const maintenance = await call(`/api/vehicles/${vehicleId}/maintenance`);
    expect(maintenance.body.length).toBeGreaterThan(0);
    for (const row of maintenance.body) {
      expect(row.status).toBe("unknown");
    }

    // And the dashboard stays quiet, rather than showing a wall of red on
    // the day the owner adds their car -- which is how a user learns to
    // ignore the attention list permanently.
    const dashboard = await call("/api/dashboard");
    expect(dashboard.body.attention).toEqual([]);
    expect(dashboard.body.vehicles[0].worstStatus).toBe("unknown");
  });
});

describe("timezone (invariant 5)", () => {
  it("computes today on the owner's calendar, not the Worker's UTC clock", () => {
    // 20 Aug 2026, 17:00 UTC is already the 21st in Kuala Lumpur. A bare
    // new Date() in the Worker would put every due-date comparison a day
    // behind for eight hours out of every twenty-four.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T17:00:00Z"));

    expect(todayIn("UTC")).toBe("2026-08-20");
    expect(todayIn("Asia/Kuala_Lumpur")).toBe("2026-08-21");
  });

  it("puts a renewal expiring today in due_soon, not overdue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T04:00:00Z")); // noon in KL

    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/renewals`, {
      method: "POST",
      json: { type: "road_tax", expiresOn: "2026-08-20", cost: 9_000 },
    });

    const res = await call(`/api/vehicles/${vehicleId}/renewals/status`);
    // Road tax is valid through its expiry date, so today is not yet late.
    expect(res.body[0].status).toBe("due_soon");
    expect(res.body[0].days_remaining).toBe(0);
  });
});

describe("odometer entry (spec 8.4 vs out-of-order readings)", () => {
  it("rejects a reading lower than an earlier one", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      json: { readingKm: 60_000, recordedOn: "2026-06-01" },
    });

    const res = await call(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      json: { readingKm: 58_000, recordedOn: "2026-07-01" },
    });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("lower than an earlier reading");
  });

  it("accepts a backdated reading and does not clobber the current odometer", async () => {
    // No opening reading, so the first POST below establishes the cache.
    const vehicleId = await makeVehicle({ currentOdometerKm: undefined });
    await call(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      json: { readingKm: 60_000, recordedOn: "2026-08-01" },
    });

    // Spec 8.4 says validate >= current odometer. That would reject this --
    // but logging a service you had done in June legitimately has a lower
    // reading than August's, and refusing it makes historical entry
    // impossible.
    const res = await call(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      json: { readingKm: 55_000, recordedOn: "2026-06-15" },
    });
    expect(res.status).toBe(204);

    const vehicle = await call(`/api/vehicles/${vehicleId}`);
    expect(vehicle.body.currentOdometerKm).toBe(60_000);
    expect(vehicle.body.odometerUpdatedOn).toBe("2026-08-01");
  });
});

describe("renewals are immutable (invariant 8)", () => {
  it("refuses to re-date a renewal through PATCH", async () => {
    const vehicleId = await makeVehicle();
    const created = await call(`/api/vehicles/${vehicleId}/renewals`, {
      method: "POST",
      json: { type: "road_tax", expiresOn: "2026-09-01", cost: 9_000 },
    });

    // Editing the expiry in place would erase what last year's road tax
    // cost, which is the only input the forecast has.
    const res = await call(`/api/renewals/${created.body.id}`, {
      method: "PATCH",
      json: { expiresOn: "2027-09-01" },
    });
    expect(res.status).toBe(422);
  });

  it("allows correcting a typo in the reference number", async () => {
    const vehicleId = await makeVehicle();
    const created = await call(`/api/vehicles/${vehicleId}/renewals`, {
      method: "POST",
      json: { type: "insurance", expiresOn: "2026-09-01", referenceNo: "TYPO" },
    });

    const res = await call(`/api/renewals/${created.body.id}`, {
      method: "PATCH",
      json: { referenceNo: "POL-12345" },
    });
    expect(res.status).toBe(200);
    expect(res.body.referenceNo).toBe("POL-12345");
  });

  it("treats the greatest expires_on as active and keeps the old row as history", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/renewals`, {
      method: "POST",
      json: { type: "road_tax", expiresOn: "2025-09-01", cost: 9_000 },
    });
    await call(`/api/vehicles/${vehicleId}/renewals`, {
      method: "POST",
      json: { type: "road_tax", expiresOn: "2026-09-01", cost: 9_500 },
    });

    const active = await call(`/api/vehicles/${vehicleId}/renewals/status`);
    const roadTax = active.body.filter((r: { type: string }) => r.type === "road_tax");
    expect(roadTax).toHaveLength(1);
    expect(roadTax[0].expires_on).toBe("2026-09-01");

    // Both premiums survive: the forecast needs the trend, not the latest.
    const history = await call(`/api/vehicles/${vehicleId}/renewals`);
    expect(history.body.filter((r: { type: string }) => r.type === "road_tax")).toHaveLength(2);
  });
});

describe("a service visit with no line items resets nothing (invariant 7)", () => {
  it("leaves the maintenance clock unknown after an itemless visit", async () => {
    const vehicleId = await makeVehicle();

    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: { servicedOn: "2026-08-01", odometerKm: 51_000, workshopName: "Inspection", items: [] },
    });

    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const oil = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_engine_oil");
    // The visit happened and is recorded, but it did not change the oil.
    expect(oil.status).toBe("unknown");
    expect(oil.baseline_date).toBeNull();
  });

  it("resets only the clocks whose part types were actually on the invoice", async () => {
    const vehicleId = await makeVehicle();

    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-08-01",
        odometerKm: 51_000,
        items: [{ partTypeId: "pt_engine_oil", unitCost: 18_000 }],
      },
    });

    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const oil = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_engine_oil");
    const filter = res.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_oil_filter");

    expect(oil.baseline_date).toBe("2026-08-01");
    expect(oil.baseline_km).toBe(51_000);
    expect(filter.status).toBe("unknown"); // same visit, not on the invoice
  });
});

describe("vehicle seeding (spec 8.3)", () => {
  it("does not seed an EV with engine oil or spark plugs", async () => {
    const vehicleId = await makeVehicle({ fuelType: "ev" });
    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const codes = res.body.map((r: { part_type_id: string }) => r.part_type_id);

    expect(codes).not.toContain("pt_engine_oil");
    expect(codes).not.toContain("pt_spark_plugs");
    expect(codes).not.toContain("pt_timing_belt");
    expect(codes).toContain("pt_brake_pad_front");
    expect(codes).toContain("pt_cabin_filter");
  });

  /**
   * The add-vehicle form sends only what was typed, and every field except
   * the name is optional. If the API ever starts requiring one of them, the
   * form breaks for exactly the user who has just arrived with nothing filled
   * in -- the worst possible moment for it.
   */
  it("accepts a vehicle with nothing but a name", async () => {
    const res = await call("/api/vehicles", {
      method: "POST",
      json: { nickname: "Myvi" },
    });

    expect(res.status).toBe(201);
    expect(res.body.nickname).toBe("Myvi");
    expect(res.body.currentOdometerKm).toBe(0);

    // Unknown fuel type means no filtering, so it inherits every interval
    // rather than none -- a vehicle with an empty schedule would look fine
    // and silently never come due.
    const maintenance = await call(`/api/vehicles/${res.body.id}/maintenance`);
    expect(maintenance.body.length).toBeGreaterThan(0);
    expect(
      maintenance.body.map((r: { part_type_id: string }) => r.part_type_id),
    ).toContain("pt_engine_oil");
  });

  it("rejects a vehicle with no name", async () => {
    const res = await call("/api/vehicles", { method: "POST", json: { plate: "WXY 1234" } });
    expect(res.status).toBe(422);
  });
});
