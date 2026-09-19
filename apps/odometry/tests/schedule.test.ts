import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb } from "./helpers";

/**
 * The schedule table (spec 8.2, 2026-09-20): GET and PUT
 * /api/vehicles/:id/schedule.
 *
 * The owner sets the schedule here and nowhere else, apart from the explicit
 * "change schedule" choice on a service. Cross-garage reads are also in
 * isolation.test.ts; the write rejections live here beside the behaviour.
 */

const U = "owner@example.com";
const call = as(U);

interface Row {
  part_type_id: string;
  applies: number;
  interval_km: number | null;
  interval_months: number | null;
  maker_km: number | null;
  maker_months: number | null;
  default_km: number | null;
  default_months: number | null;
}

async function makeVehicle(extra: Record<string, unknown> = {}) {
  const res = await call("/api/vehicles", {
    method: "POST",
    json: { nickname: "Test Car", fuelType: "petrol", currentOdometerKm: 50_000, ...extra },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function schedule(vehicleId: string): Promise<Row[]> {
  const res = await call(`/api/vehicles/${vehicleId}/schedule`);
  expect(res.status).toBe(200);
  return res.body;
}

const row = (rows: Row[], id: string) => rows.find((r) => r.part_type_id === id);

function put(vehicleId: string, rows: Record<string, unknown>[]) {
  return call(`/api/vehicles/${vehicleId}/schedule`, { method: "PUT", json: { rows } });
}

/** A full row with nothing set, to spread overrides into. */
const blank = (partTypeId: string) => ({
  partTypeId,
  intervalKm: null,
  intervalMonths: null,
  makerKm: null,
  makerMonths: null,
});

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await resetDb();
});

describe("reading the schedule", () => {
  it("starts a new vehicle on the generic defaults, and says what they are", async () => {
    const id = await makeVehicle();
    const oil = row(await schedule(id), "pt_engine_oil");
    expect(oil).toMatchObject({
      applies: 1,
      interval_km: 10_000,
      interval_months: 12,
      default_km: 10_000,
      default_months: 12,
      maker_km: null,
      maker_months: null,
    });
  });

  it("lists parts the vehicle fits but does not track, with blank cells", async () => {
    // Timing chain is inspect-on-symptom: it fits a car but ships with no
    // interval, so it is not seeded. It must still appear, or it could never
    // be switched on from the table.
    const id = await makeVehicle();
    const chain = row(await schedule(id), "pt_timing_chain");
    expect(chain).toMatchObject({ applies: 1, interval_km: null, interval_months: null });
  });

  it("never offers a motorcycle a car-only part", async () => {
    const id = await makeVehicle({ vehicleType: "motorcycle" });
    const rows = await schedule(id);
    expect(row(rows, "pt_cabin_filter")).toBeUndefined();
    expect(row(rows, "pt_engine_oil")?.interval_km).toBe(3_000);
  });

  it("filters by fuel: an EV is not offered engine oil", async () => {
    const id = await makeVehicle({ fuelType: "ev" });
    expect(row(await schedule(id), "pt_engine_oil")).toBeUndefined();
  });

  it("keeps showing a tracked part that stopped fitting when the fuel changed", async () => {
    // The gap this closes: fuel is filtered only when a vehicle is created,
    // so a petrol car changed to EV kept engine oil on its schedule with
    // nothing on screen to say so. Now it is listed, flagged, and clearable.
    const id = await makeVehicle({ fuelType: "petrol" });
    await call(`/api/vehicles/${id}`, { method: "PATCH", json: { fuelType: "ev" } });

    const oil = row(await schedule(id), "pt_engine_oil");
    expect(oil).toMatchObject({ applies: 0, interval_km: 10_000 });

    expect((await put(id, [blank("pt_engine_oil")])).status).toBe(200);
    expect(row(await schedule(id), "pt_engine_oil")).toBeUndefined();
  });

  it("includes the garage's own part types", async () => {
    const id = await makeVehicle();
    const created = await call("/api/part-types", {
      method: "POST",
      json: { name: "Chain lube", category: "other", defaultIntervalKm: 500 },
    });
    expect(created.status).toBe(201);
    const custom = row(await schedule(id), created.body.id);
    expect(custom).toBeDefined();
  });
});

describe("saving the schedule", () => {
  it("changes an interval, and the due point moves with it", async () => {
    const id = await makeVehicle();
    await call(`/api/vehicles/${id}/services`, {
      method: "POST",
      json: { servicedOn: "2026-02-10", odometerKm: 50_000, items: [{ partTypeId: "pt_engine_oil" }] },
    });

    const res = await put(id, [{ ...blank("pt_engine_oil"), intervalKm: 6_000, intervalMonths: 6 }]);
    expect(res.status).toBe(200);
    // The response IS the new table, so the client needs no second request.
    expect(row(res.body, "pt_engine_oil")).toMatchObject({ interval_km: 6_000, interval_months: 6 });

    const due = (await call(`/api/vehicles/${id}/maintenance`)).body.find(
      (r: { part_type_id: string }) => r.part_type_id === "pt_engine_oil",
    );
    expect(due.due_km).toBe(56_000);
    expect(due.due_date_by_time).toBe("2026-08-10");
  });

  it("replaces both halves rather than merging, so a cleared cell stays cleared", async () => {
    // Engine oil starts at 10,000 km AND 12 months. Saving km only means
    // "no time clock" -- a COALESCE would quietly keep the 12 months.
    const id = await makeVehicle();
    await put(id, [{ ...blank("pt_engine_oil"), intervalKm: 8_000 }]);
    expect(row(await schedule(id), "pt_engine_oil")).toMatchObject({
      interval_km: 8_000,
      interval_months: null,
    });
  });

  it("starts tracking a part the seeder skipped", async () => {
    const id = await makeVehicle();
    await put(id, [{ ...blank("pt_timing_chain"), intervalKm: 150_000 }]);
    const chain = (await call(`/api/vehicles/${id}/maintenance`)).body.find(
      (r: { part_type_id: string }) => r.part_type_id === "pt_timing_chain",
    );
    expect(chain.interval_km).toBe(150_000);
    expect(chain.status).toBe("unknown"); // tracked, but no baseline yet
  });

  it("switches a part off when both cells are blank, and keeps its numbers", async () => {
    const id = await makeVehicle();
    await put(id, [blank("pt_timing_belt")]);

    const maint = (await call(`/api/vehicles/${id}/maintenance`)).body;
    expect(maint.some((r: { part_type_id: string }) => r.part_type_id === "pt_timing_belt")).toBe(
      false,
    );
    // Still listed on the schedule, untracked.
    expect(row(await schedule(id), "pt_timing_belt")).toMatchObject({ interval_km: null });

    // Switched off is not deleted: the row survives with its old figures.
    const stored = await env.DB.prepare(
      `SELECT interval_km, is_active FROM maintenance_intervals
        WHERE vehicle_id = ? AND part_type_id = 'pt_timing_belt'`,
    )
      .bind(id)
      .first();
    expect(stored).toEqual({ interval_km: 100_000, is_active: 0 });

    // And typing a number switches it back on.
    await put(id, [{ ...blank("pt_timing_belt"), intervalKm: 90_000 }]);
    expect(row(await schedule(id), "pt_timing_belt")?.interval_km).toBe(90_000);
  });

  it("stores and clears the maker figure without touching the schedule", async () => {
    const id = await makeVehicle();
    await put(id, [
      { ...blank("pt_spark_plugs"), intervalKm: 50_000, makerKm: 40_000, makerMonths: 24 },
    ]);
    expect(row(await schedule(id), "pt_spark_plugs")).toMatchObject({
      interval_km: 50_000,
      maker_km: 40_000,
      maker_months: 24,
    });

    await put(id, [{ ...blank("pt_spark_plugs"), intervalKm: 50_000 }]);
    expect(row(await schedule(id), "pt_spark_plugs")).toMatchObject({
      interval_km: 50_000,
      maker_km: null,
      maker_months: null,
    });
  });

  it("keeps a maker figure for a part the owner does not track", async () => {
    // The reason maker_intervals is its own table: maintenance_intervals'
    // CHECK would refuse a row with a maker figure and no schedule.
    const id = await makeVehicle();
    await put(id, [{ ...blank("pt_timing_chain"), makerKm: 200_000 }]);
    expect(row(await schedule(id), "pt_timing_chain")).toMatchObject({
      interval_km: null,
      maker_km: 200_000,
    });
  });

  it("refuses a zero, a negative, or a fraction", async () => {
    const id = await makeVehicle();
    for (const bad of [0, -5_000, 5_000.5]) {
      expect((await put(id, [{ ...blank("pt_engine_oil"), intervalKm: bad }])).status).toBe(422);
    }
  });

  it("refuses the same part twice in one save", async () => {
    const id = await makeVehicle();
    const res = await put(id, [
      { ...blank("pt_engine_oil"), intervalKm: 5_000 },
      { ...blank("pt_engine_oil"), intervalKm: 6_000 },
    ]);
    expect(res.status).toBe(422);
  });

  it("refuses to give a motorcycle a car-only part, and writes nothing", async () => {
    const id = await makeVehicle({ vehicleType: "motorcycle" });
    const res = await put(id, [
      { ...blank("pt_engine_oil"), intervalKm: 2_000 },
      { ...blank("pt_cabin_filter"), intervalKm: 20_000 },
    ]);
    expect(res.status).toBe(422);
    // All or nothing: the valid row in the same save did not land.
    expect(row(await schedule(id), "pt_engine_oil")?.interval_km).toBe(3_000);
  });

  it("refuses a viewer", async () => {
    const id = await makeVehicle();
    const garage = await env.DB.prepare(`SELECT garage_id FROM vehicles WHERE id = ?`)
      .bind(id)
      .first<{ garage_id: string }>();
    // Provisioned by hand, with NO garage of their own. Calling the API first
    // would bootstrap them an owned garage, which scope prefers over this
    // membership -- and the test would then pass on a 404 for the wrong reason.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, display_name, created_at)
         VALUES ('u_viewer', 'viewer@example.com', 'viewer', '2026-09-20T00:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO garage_members (garage_id, user_id, role) VALUES (?, 'u_viewer', 'viewer')`,
      ).bind(garage!.garage_id),
    ]);
    // They can read it...
    expect((await as("viewer@example.com")(`/api/vehicles/${id}/schedule`)).status).toBe(200);

    const res = await as("viewer@example.com")(`/api/vehicles/${id}/schedule`, {
      method: "PUT",
      json: { rows: [{ ...blank("pt_engine_oil"), intervalKm: 1_000 }] },
    });
    // ...but not change it. 401 is what assertCanWrite has always returned
    // for a viewer, app-wide; the point here is the refusal, and that the
    // schedule is untouched after it.
    expect(res.status).toBe(401);
    expect(row(await schedule(id), "pt_engine_oil")?.interval_km).toBe(10_000);
  });
});

describe("the schedule is never another garage's", () => {
  it("404s on another garage's vehicle, for reads and writes, and writes nothing", async () => {
    const theirs = await makeVehicle();
    const other = as("other@example.com");

    expect((await other(`/api/vehicles/${theirs}/schedule`)).status).toBe(404);
    const res = await other(`/api/vehicles/${theirs}/schedule`, {
      method: "PUT",
      json: { rows: [{ ...blank("pt_engine_oil"), intervalKm: 1_000, makerKm: 1_000 }] },
    });
    expect(res.status).toBe(404);
    expect(row(await schedule(theirs), "pt_engine_oil")).toMatchObject({
      interval_km: 10_000,
      maker_km: null,
    });
  });

  it("404s on another garage's part type", async () => {
    const created = await call("/api/part-types", {
      method: "POST",
      json: { name: "Owner only part", category: "other", defaultIntervalKm: 500 },
    });
    const other = as("other@example.com");
    const mine = await other("/api/vehicles", {
      method: "POST",
      json: { nickname: "Other car", fuelType: "petrol" },
    });
    const res = await other(`/api/vehicles/${mine.body.id}/schedule`, {
      method: "PUT",
      json: { rows: [{ ...blank(created.body.id), intervalKm: 500 }] },
    });
    expect(res.status).toBe(404);
  });
});

describe("a vehicle's type cannot be changed after it is created", () => {
  it("ignores vehicleType on an edit rather than leaving car parts on a bike", async () => {
    const id = await makeVehicle();
    const res = await call(`/api/vehicles/${id}`, {
      method: "PATCH",
      json: { vehicleType: "motorcycle" },
    });
    expect([200, 422]).toContain(res.status);
    const v = await call(`/api/vehicles/${id}`);
    expect(v.body.vehicleType).toBe("car");
  });
});
