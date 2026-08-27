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
        labourCost: 38_050,
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
      ["service_records", "labour_cost"],
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

/**
 * Labour is its own cost, and the grand total is derived from it plus the
 * parts (migration 0006). The owner's usual pattern is the motivating case:
 * buy the oil and filter, then pay a workshop for the fitting alone.
 */
describe("labour and the derived total (invariant 1)", () => {
  const fetchRecord = async (vehicleId: string) =>
    (await call(`/api/vehicles/${vehicleId}/services`)).body[0] as {
      partsCost: number | null;
      labourCost: number | null;
      totalCost: number | null;
    };

  it("adds labour to the parts to make the total", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        labourCost: 6_000, // RM 60.00
        items: [
          { partTypeId: "pt_engine_oil", unitCost: 12_000 },
          { partTypeId: "pt_oil_filter", unitCost: 2_500 },
        ],
      },
    });

    const rec = await fetchRecord(vehicleId);
    expect(rec.partsCost).toBe(14_500);
    expect(rec.labourCost).toBe(6_000);
    expect(rec.totalCost).toBe(20_500);
  });

  it("handles the owner-supplied-parts case: labour only, no part costs", async () => {
    const vehicleId = await makeVehicle();
    // Parts bought elsewhere, so they carry no cost here. The workshop
    // charged for the change alone -- the total is the labour.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        labourCost: 4_500,
        items: [{ partTypeId: "pt_engine_oil" }, { partTypeId: "pt_oil_filter" }],
      },
    });

    const rec = await fetchRecord(vehicleId);
    expect(rec.partsCost).toBeNull();
    expect(rec.labourCost).toBe(4_500);
    expect(rec.totalCost).toBe(4_500);
  });

  it("leaves the total blank when no cost was recorded at all", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        items: [{ partTypeId: "pt_engine_oil" }],
      },
    });

    // Not RM 0.00. "I did not record what this cost" and "this was free" are
    // different statements, and the UI shows nothing rather than a false zero.
    const rec = await fetchRecord(vehicleId);
    expect(rec.totalCost).toBeNull();
    expect(rec.labourCost).toBeNull();
  });

  it("does not multiply the parts by the number of line items", async () => {
    const vehicleId = await makeVehicle();
    // The read query joins items onto the record, so a naive SUM() over that
    // join counts each part once per row. Three items is enough to catch it.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 45_000,
        labourCost: 1_000,
        items: [
          { partTypeId: "pt_engine_oil", unitCost: 10_000 },
          { partTypeId: "pt_oil_filter", unitCost: 2_000 },
          { partTypeId: "pt_air_filter", unitCost: 3_000 },
        ],
      },
    });

    const rec = await fetchRecord(vehicleId);
    expect(rec.partsCost).toBe(15_000);
    expect(rec.totalCost).toBe(16_000);
  });
});

/**
 * The wear-and-tear set added in migration 0007, and the rule that decides
 * which of it lands on a new vehicle.
 *
 * A part type with a default interval on either column is seeded; one with
 * NULL on both is not, and waits in "Not tracked on this car". That is the
 * only lever the schema has for parts that depend on the car rather than the
 * fuel -- a clutch on an automatic, drums on a car with rear discs -- so it
 * is worth a test that fails loudly if a NULL is ever filled in casually.
 */
describe("wear parts seed selectively (migration 0007)", () => {
  const trackedIds = async (vehicleId: string) =>
    ((await call(`/api/vehicles/${vehicleId}/maintenance`)).body as {
      part_type_id: string;
    }[]).map((r) => r.part_type_id);

  it("seeds the suspension and steering parts onto a new petrol car", async () => {
    const tracked = await trackedIds(await makeVehicle());

    for (const id of [
      "pt_absorber_front",
      "pt_absorber_rear",
      "pt_stabiliser_link",
      "pt_lower_arm_bush",
      "pt_ball_joint",
      "pt_tie_rod_end",
      "pt_cv_boot",
      "pt_engine_mount",
      "pt_radiator_hose",
      "pt_wheel_alignment",
    ]) {
      expect(tracked, `${id} should be tracked`).toContain(id);
    }
  });

  it("leaves car-specific parts untracked until they are asked for", async () => {
    const tracked = await trackedIds(await makeVehicle());

    // Both NULL defaults. Seeding these would assert that every car has a
    // clutch, a differential, AND rear drums on top of the rear discs it was
    // already given.
    for (const id of [
      "pt_clutch",
      "pt_diff_oil",
      "pt_brake_shoe_rear",
      "pt_brake_drum_rear",
      "pt_coil_spring",
      "pt_thermostat",
    ]) {
      expect(tracked, `${id} should NOT be seeded`).not.toContain(id);
    }
  });

  it("keeps engine-only parts off an EV", async () => {
    const tracked = await trackedIds(await makeVehicle({ fuelType: "ev" }));

    expect(tracked).not.toContain("pt_water_pump");
    expect(tracked).not.toContain("pt_pcv_valve");
    expect(tracked).not.toContain("pt_ignition_coil");
    expect(tracked).not.toContain("pt_engine_oil");

    // Suspension wears out whatever is driving the wheels.
    expect(tracked).toContain("pt_absorber_front");
    expect(tracked).toContain("pt_wheel_alignment");
  });

  it("gives every part type a category the client can group under", async () => {
    // A category the display order does not know about renders in a trailing
    // "unknown" bucket rather than vanishing, but it should never happen: this
    // is the CHECK constraint, the Zod enum and CATEGORY_ORDER agreeing.
    const known = [
      "fluid", "filter", "brake", "tyre", "battery", "belt", "electrical",
      "other", "suspension", "drivetrain", "cooling", "engine",
    ];
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT category FROM part_types`,
    ).all<{ category: string }>();

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(known).toContain(r.category);
  });
});

/**
 * Motorbikes (migration 0008).
 *
 * The catalogue is keyed by vehicle type now, and gets it wrong in two
 * directions if the join is missed: a bike offered car parts it does not have,
 * or a bike seeded at car intervals -- which for engine oil is 10,000 km on a
 * thing that wants 3,000, and is the kind of wrong that ruins an engine
 * quietly.
 */
describe("motorcycles get their own catalogue (migration 0008)", () => {
  const trackedIds = async (vehicleId: string) =>
    ((await call(`/api/vehicles/${vehicleId}/maintenance`)).body as {
      part_type_id: string;
    }[]).map((r) => r.part_type_id);

  const makeBike = (extra: Record<string, unknown> = {}) =>
    makeVehicle({ nickname: "Test Bike", vehicleType: "motorcycle", ...extra });

  it("seeds bike parts and none of the car-only ones", async () => {
    const tracked = await trackedIds(await makeBike());

    for (const id of ["pt_fork_oil", "pt_rear_shock", "pt_valve_clearance", "pt_engine_oil"]) {
      expect(tracked, `${id} should be tracked on a bike`).toContain(id);
    }

    // A bike has no cabin, no aircon, no wipers, no ATF, no power steering, no
    // CV joints, and none of the car suspension.
    for (const id of [
      "pt_cabin_filter",
      "pt_aircon_service",
      "pt_wiper_blades",
      "pt_gearbox_oil",
      "pt_power_steer_fluid",
      "pt_cv_boot",
      "pt_absorber_front",
      "pt_tie_rod_end",
      "pt_wheel_alignment",
      "pt_timing_belt",
    ]) {
      expect(tracked, `${id} must not reach a bike`).not.toContain(id);
    }
  });

  it("gives the SAME part type a different interval per vehicle type", async () => {
    // The whole reason intervals moved out of part_types. One pt_engine_oil,
    // so brand history and service records stay together, two schedules.
    const bikeRows = (await call(`/api/vehicles/${await makeBike()}/maintenance`))
      .body as { part_type_id: string; interval_km: number }[];
    const carRows = (await call(`/api/vehicles/${await makeVehicle()}/maintenance`))
      .body as { part_type_id: string; interval_km: number }[];

    const oil = (rows: typeof bikeRows) =>
      rows.find((r) => r.part_type_id === "pt_engine_oil")!.interval_km;

    expect(oil(bikeRows)).toBe(3_000);
    expect(oil(carRows)).toBe(10_000);
  });

  it("assumes neither a chain nor a CVT", async () => {
    // A bike is one or the other and the schema has no column that says which,
    // so both are offered and neither is seeded -- the same treatment rear
    // discs versus drums already get.
    const tracked = await trackedIds(await makeBike());
    expect(tracked).not.toContain("pt_chain_sprocket");
    expect(tracked).not.toContain("pt_cvt_belt");

    const catalogue = (await call("/api/part-types?vehicleType=motorcycle")).body as {
      id: string;
    }[];
    const ids = catalogue.map((p) => p.id);
    expect(ids).toContain("pt_chain_sprocket");
    expect(ids).toContain("pt_cvt_belt");
  });

  it("composes the fuel filter with the type filter on an electric bike", async () => {
    const tracked = await trackedIds(await makeBike({ fuelType: "ev" }));

    expect(tracked).not.toContain("pt_engine_oil");
    expect(tracked).not.toContain("pt_spark_plugs");
    expect(tracked).not.toContain("pt_valve_clearance");

    // Forks and tyres wear out regardless of what turns the wheel.
    expect(tracked).toContain("pt_fork_oil");
    expect(tracked).toContain("pt_tyres");
  });

  it("keeps the car catalogue free of bike parts", async () => {
    const tracked = await trackedIds(await makeVehicle());
    for (const id of ["pt_fork_oil", "pt_chain_sprocket", "pt_valve_clearance"]) {
      expect(tracked, `${id} must not reach a car`).not.toContain(id);
    }

    const catalogue = (await call("/api/part-types?vehicleType=car")).body as { id: string }[];
    expect(catalogue.map((p) => p.id)).not.toContain("pt_fork_oil");
  });

  it("defaults an untyped vehicle to a car", async () => {
    // vehicleType has a Zod default rather than being optional: a vehicle with
    // no type would join to nothing and be seeded with no parts at all.
    const res = await call("/api/vehicles", {
      method: "POST",
      json: { nickname: "Untyped", fuelType: "petrol" },
    });
    expect(res.status).toBe(201);
    expect((await trackedIds(res.body.id as string))).toContain("pt_cabin_filter");
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

/**
 * The "next scheduled mileage" the owner types on a service is stored as an
 * INTERVAL from that service, never as an absolute due point (invariant 6).
 *
 * Every test here is really the same assertion from a different angle: the
 * due point is a function of the baseline, so it moves when the baseline
 * moves. A stored due point passes the first test and fails all the rest,
 * silently, while continuing to display a plausible number.
 *
 * The interval keyed in at a service also BECOMES the vehicle's interval --
 * one number per part, set by the most recent service. See CLAUDE.md
 * invariant 6.
 */
describe("per-service intervals (invariant 6)", () => {
  const findOil = (body: { part_type_id: string }[]) =>
    body.find((r) => r.part_type_id === "pt_engine_oil") as never as {
      due_km: number | null;
      interval_km: number | null;
      due_date_by_time: string | null;
      status: string;
    };

  it("makes the interval keyed at a service the vehicle's interval", async () => {
    const vehicleId = await makeVehicle();
    // Engine oil is seeded at 10,000 km. Cheap mineral oil this time, so the
    // workshop says come back at 55,000 -- a 5,000 km interval from here on.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_engine_oil", intervalKmOverride: 5_000 }],
      },
    });

    const oil = findOil((await call(`/api/vehicles/${vehicleId}/maintenance`)).body);
    expect(oil.due_km).toBe(55_000);
    expect(oil.interval_km).toBe(5_000);
  });

  it("derives the due point from the baseline rather than storing it", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_engine_oil", intervalKmOverride: 5_000 }],
      },
    });
    expect(findOil((await call(`/api/vehicles/${vehicleId}/maintenance`)).body).due_km).toBe(
      55_000,
    );

    // Same part, same 5,000 km override, but 8,000 km later. A stored due
    // point would still read 55,000 -- a figure now in the past.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-06-10",
        odometerKm: 58_000,
        items: [{ partTypeId: "pt_engine_oil", intervalKmOverride: 5_000 }],
      },
    });

    expect(findOil((await call(`/api/vehicles/${vehicleId}/maintenance`)).body).due_km).toBe(
      63_000,
    );
  });

  it("keeps the last keyed interval when a later service sets none", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_engine_oil", intervalKmOverride: 5_000 }],
      },
    });

    // A service that names the part but sets no interval. The schedule is
    // not re-opened for negotiation: 5,000 km stands until something says
    // otherwise, it just counts from the new baseline.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-06-10",
        odometerKm: 55_000,
        items: [{ partTypeId: "pt_engine_oil" }],
      },
    });

    const oil = findOil((await call(`/api/vehicles/${vehicleId}/maintenance`)).body);
    expect(oil.interval_km).toBe(5_000);
    expect(oil.due_km).toBe(60_000); // 55,000 baseline + 5,000
  });

  it("lets editing the interval take effect on the cycle already running", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_engine_oil", intervalKmOverride: 5_000 }],
      },
    });
    expect(findOil((await call(`/api/vehicles/${vehicleId}/maintenance`)).body).due_km).toBe(
      55_000,
    );

    // The owner corrects the schedule to 6,000 km. This is the regression
    // that started it all: the edit used to be stored but outranked by the
    // last service's number, so the due point never moved and the save read
    // as having silently failed.
    await call(`/api/vehicles/${vehicleId}/intervals/pt_engine_oil`, {
      method: "PATCH",
      json: { intervalKm: 6_000 },
    });

    const oil = findOil((await call(`/api/vehicles/${vehicleId}/maintenance`)).body);
    expect(oil.interval_km).toBe(6_000);
    expect(oil.due_km).toBe(56_000); // 50,000 baseline + 6,000, immediately
  });

  it("keeps a km-only override from nulling out the time clock", async () => {
    const vehicleId = await makeVehicle();
    // Engine oil is seeded 10,000 km AND 12 months. Overriding only the km
    // half must leave the months half alone, not blank it.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_engine_oil", intervalKmOverride: 5_000 }],
      },
    });

    const oil = findOil((await call(`/api/vehicles/${vehicleId}/maintenance`)).body);
    expect(oil.due_km).toBe(55_000);
    expect(oil.due_date_by_time).toBe("2027-02-10"); // +12 months, unchanged
  });

  it("gives an override somewhere to land when the part has no active interval", async () => {
    const vehicleId = await makeVehicle();

    // Timing chain ships with no default intervals, so the seeder skips it
    // and there is no maintenance_intervals row at all. Without the upsert in
    // ServiceRepo.create the override would be stored and never displayed:
    // v_maintenance_due starts FROM maintenance_intervals.
    const before = await call(`/api/vehicles/${vehicleId}/maintenance`);
    expect(
      before.body.find((r: { part_type_id: string }) => r.part_type_id === "pt_timing_chain"),
    ).toBeUndefined();

    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_timing_chain", intervalKmOverride: 150_000 }],
      },
    });

    const after = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const chain = after.body.find(
      (r: { part_type_id: string }) => r.part_type_id === "pt_timing_chain",
    );
    expect(chain).toBeDefined();
    expect(chain.due_km).toBe(200_000);
    expect(chain.status).toBe("ok");
  });
});

describe("per-vehicle interval configuration (spec 8.2)", () => {
  it("starts tracking a part the seeder skipped", async () => {
    // The belt-versus-chain case. Timing chain has no default intervals, so
    // no interval row exists and there is nothing on screen to switch on.
    const vehicleId = await makeVehicle();
    const res = await call(`/api/vehicles/${vehicleId}/intervals/pt_timing_chain`, {
      method: "PATCH",
      json: { intervalKm: 150_000 },
    });
    expect(res.status).toBe(200);

    const rows = (await call(`/api/vehicles/${vehicleId}/maintenance`)).body;
    const chain = rows.find(
      (r: { part_type_id: string }) => r.part_type_id === "pt_timing_chain",
    );
    expect(chain.interval_km).toBe(150_000);
    expect(chain.status).toBe("unknown"); // tracked, but no baseline yet
  });

  it("hides a part switched off, and brings it back when switched on", async () => {
    const vehicleId = await makeVehicle();
    const present = (body: { part_type_id: string }[]) =>
      body.some((r) => r.part_type_id === "pt_timing_belt");

    expect(present((await call(`/api/vehicles/${vehicleId}/maintenance`)).body)).toBe(true);

    await call(`/api/vehicles/${vehicleId}/intervals/pt_timing_belt`, {
      method: "PATCH",
      json: { isActive: 0 },
    });
    expect(present((await call(`/api/vehicles/${vehicleId}/maintenance`)).body)).toBe(false);

    await call(`/api/vehicles/${vehicleId}/intervals/pt_timing_belt`, {
      method: "PATCH",
      json: { isActive: 1 },
    });
    expect(present((await call(`/api/vehicles/${vehicleId}/maintenance`)).body)).toBe(true);
  });

  it("refuses an interval with neither a distance nor a time", async () => {
    const vehicleId = await makeVehicle();
    const res = await call(`/api/vehicles/${vehicleId}/intervals/pt_engine_oil`, {
      method: "PATCH",
      json: { intervalKm: null, intervalMonths: null },
    });
    expect(res.status).toBe(422);
  });
});

describe("service type is a label, not a clock (invariant 7)", () => {
  it("resets nothing when a typed service has no line items", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        serviceType: "major",
        items: [],
      },
    });

    // Calling it a major service does not make it one. Only items count.
    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    for (const row of res.body) {
      expect(row.status).toBe("unknown");
    }

    const services = await call(`/api/vehicles/${vehicleId}/services`);
    expect(services.body[0].serviceType).toBe("major");
  });

  it("rejects a service type outside the allowed set", async () => {
    const vehicleId = await makeVehicle();
    const res = await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: { servicedOn: "2026-02-10", odometerKm: 50_000, serviceType: "supermajor" },
    });
    expect(res.status).toBe(422);
  });
});

describe("warranty is derived and display-only", () => {
  it("expires the warranty months after the service date", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_battery", warrantyMonths: 18 }],
      },
    });

    const item = (await call(`/api/vehicles/${vehicleId}/services`)).body[0].items[0];
    expect(item.warrantyExpiresOn).toBe("2027-08-10");

    // Display only: a warranty never becomes an attention item.
    const dashboard = await call("/api/dashboard");
    expect(dashboard.body.attention.every((a: { kind: string }) => a.kind !== "warranty")).toBe(
      true,
    );
  });

  it("leaves the expiry null when no warranty was recorded", async () => {
    const vehicleId = await makeVehicle();
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-02-10",
        odometerKm: 50_000,
        items: [{ partTypeId: "pt_battery" }],
      },
    });

    const item = (await call(`/api/vehicles/${vehicleId}/services`)).body[0].items[0];
    expect(item.warrantyExpiresOn).toBeNull();
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

/**
 * These two were hard-coded literals. They are settings now because neither
 * has a defensible universal value -- how far you drive in a day, and how
 * long a reading stays trustworthy, are properties of the owner.
 */
describe("assumed usage rate and staleness come from settings", () => {
  it("projects the km due date using the configured fallback rate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T04:00:00Z")); // 2026-08-20 in UTC+8

    const vehicleId = await makeVehicle({ currentOdometerKm: 50_000 });
    // Front brake pads: km-only, 40,000 km. Serviced at 45,000, so due at
    // 85,000 -- 35,000 km beyond the current 50,000.
    await call(`/api/vehicles/${vehicleId}/services`, {
      method: "POST",
      json: {
        servicedOn: "2026-01-05",
        odometerKm: 45_000,
        items: [{ partTypeId: "pt_brake_pad_front" }],
      },
    });

    await call("/api/me/settings", { method: "PATCH", json: { fallbackKmPerDay: 100 } });

    const res = await call(`/api/vehicles/${vehicleId}/maintenance`);
    const pads = res.body.find(
      (r: { part_type_id: string }) => r.part_type_id === "pt_brake_pad_front",
    );
    // 35,000 km at 100 km/day = 350 days, not the 1,166 the old literal gave.
    expect(pads.low_confidence).toBe(1);
    expect(pads.days_remaining).toBe(350);
  });

  it("flags a stale odometer against the configured threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T04:00:00Z"));

    // No opening odometer: otherwise the vehicle is created with
    // odometer_updated_on = today, and the backdated reading below correctly
    // refuses to move that date backwards, leaving the age at zero.
    const vehicleId = await makeVehicle({ currentOdometerKm: undefined });
    await call(`/api/vehicles/${vehicleId}/odometer`, {
      method: "POST",
      json: { readingKm: 51_000, recordedOn: "2026-08-10" },
    });

    // Ten days old: quiet at the 45-day default.
    expect((await call("/api/dashboard")).body.staleOdometers).toEqual([]);

    await call("/api/me/settings", { method: "PATCH", json: { staleOdometerDays: 7 } });

    const after = await call("/api/dashboard");
    expect(after.body.staleOdometers).toHaveLength(1);
    expect(after.body.staleOdometers[0].vehicleId).toBe(vehicleId);
    expect(after.body.staleOdometers[0].daysSince).toBe(10);
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
