import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { as, migrate, resetDb, pdfBytes, filePart } from "./helpers";

/**
 * THE MOST IMPORTANT TEST IN THIS PROJECT. Spec 5.2, CLAUDE.md.
 *
 * D1 has no row-level security. Supabase would have refused to return
 * another tenant's rows; D1 will hand them over the moment a `WHERE
 * garage_id = ?` goes missing, and nothing else in the stack will notice.
 * This suite is what stands in for that missing database guarantee.
 *
 * It seeds two garages, then calls every read endpoint as user A and asserts
 * that nothing belonging to user B comes back -- not in a list, not by
 * direct ID, and not anywhere in the response body.
 *
 * WHEN YOU ADD AN ENDPOINT, ADD IT HERE. No exceptions.
 */

const A = "alice@example.com";
const B = "bob@example.com";

// Every string here is unique to B. If one of them ever appears in a
// response to A, isolation is broken -- whichever endpoint leaked it.
const B_MARKERS = [
  "BOB_VEHICLE_NICKNAME",
  "BOB_PLATE_9999",
  "BOB_WORKSHOP",
  "BOB_BRAND",
  "BOB_ITEM_NOTE",
  "BOB_INSURER",
  "BOB_POLICY_REF",
  "BOB_SPARE_PART",
  "BOB_RECEIPT_FILENAME",
];

interface Seeded {
  vehicleId: string;
  serviceId: string;
  renewalId: string;
  partTypeId: string;
  attachmentId: string;
}

async function seed(email: string, tag: string): Promise<Seeded> {
  const call = as(email);

  const vehicle = await call("/api/vehicles", {
    method: "POST",
    json: {
      nickname: `${tag}_VEHICLE_NICKNAME`,
      plate: tag === "BOB" ? "BOB_PLATE_9999" : "ALICE_PLATE_1111",
      fuelType: "petrol",
      currentOdometerKm: 50_000,
    },
  });
  expect(vehicle.status).toBe(201);
  const vehicleId = vehicle.body.id as string;

  const service = await call(`/api/vehicles/${vehicleId}/services`, {
    method: "POST",
    json: {
      servicedOn: "2026-02-10",
      odometerKm: 45_000,
      workshopName: `${tag}_WORKSHOP`,
      totalCost: 38_000,
      items: [
        {
          partTypeId: "pt_engine_oil",
          brand: `${tag}_BRAND`,
          // A free-text column returned by /api/vehicles/:id/services
          // (migration 0017). No endpoint was added for it, so the sweep below
          // is the only thing that would notice it leaking.
          note: `${tag}_ITEM_NOTE`,
          quantityMilli: 4_500,
          unitCost: 4_200,
        },
      ],
    },
  });
  expect(service.status).toBe(201);

  const renewal = await call(`/api/vehicles/${vehicleId}/renewals`, {
    method: "POST",
    json: {
      type: "insurance",
      provider: `${tag}_INSURER`,
      referenceNo: `${tag}_POLICY_REF`,
      expiresOn: "2026-09-15",
      cost: 145_000,
    },
  });
  expect(renewal.status).toBe(201);

  await call(`/api/vehicles/${vehicleId}/odometer`, {
    method: "POST",
    json: { readingKm: 52_000, recordedOn: "2026-08-01" },
  });

  // A garage-owned part type, and a service template that references it.
  // Both are garage-scoped reference data, which is the category most likely
  // to be treated as global by accident.
  const partType = await call("/api/part-types", {
    method: "POST",
    json: { name: `${tag}_SPARE_PART`, category: "other", defaultIntervalKm: 30_000 },
  });
  expect(partType.status).toBe(201);
  const partTypeId = partType.body.id as string;

  const template = await call("/api/service-templates/minor", {
    method: "PUT",
    json: { partTypeIds: ["pt_engine_oil", partTypeId] },
  });
  expect(template.status).toBe(200);

  // A receipt on the service visit. The filename carries the marker, so a
  // listing that leaks across garages shows up in the broad sweep below.
  const attachment = await call(`/api/services/${service.body.id}/attachments`, {
    method: "POST",
    form: filePart(pdfBytes(tag), `${tag}_RECEIPT_FILENAME.pdf`),
  });
  expect(attachment.status).toBe(201);

  return {
    vehicleId,
    serviceId: service.body.id as string,
    renewalId: renewal.body.id as string,
    partTypeId,
    attachmentId: attachment.body.id as string,
  };
}

describe("cross-tenant isolation", () => {
  let alice: Seeded;
  let bob: Seeded;

  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await resetDb();
    alice = await seed(A, "ALICE");
    bob = await seed(B, "BOB");
  });

  it("gives the two users separate garages", async () => {
    const a = await as(A)("/api/me");
    const b = await as(B)("/api/me");
    expect(a.status).toBe(200);
    expect(a.body.activeGarageId).not.toBe(b.body.activeGarageId);
  });

  /**
   * The broad sweep. Every read endpoint, called as A, scanned for any of
   * B's marker strings. This is the assertion that catches an endpoint
   * someone added without thinking about scoping -- provided they added it
   * to the list below, which is the one manual step this suite cannot
   * automate away.
   */
  it("never returns any of B's data from any read endpoint", async () => {
    const call = as(A);

    const readEndpoints = [
      "/api/me",
      "/api/dashboard",
      "/api/vehicles",
      `/api/vehicles/${alice.vehicleId}`,
      `/api/vehicles/${alice.vehicleId}/odometer`,
      `/api/vehicles/${alice.vehicleId}/maintenance`,
      `/api/vehicles/${alice.vehicleId}/fuel`,
      `/api/vehicles/${alice.vehicleId}/services`,
      `/api/services/${alice.serviceId}/attachments`,
      `/api/vehicles/${alice.vehicleId}/renewals`,
      `/api/vehicles/${alice.vehicleId}/renewals/status`,
      "/api/part-types",
      "/api/part-types/pt_engine_oil/brands",
      "/api/service-templates",
      // B's own IDs, guessed by A. These must 404 or come back empty --
      // never 403, which would confirm the ID exists somewhere.
      `/api/vehicles/${bob.vehicleId}`,
      `/api/vehicles/${bob.vehicleId}/odometer`,
      `/api/vehicles/${bob.vehicleId}/maintenance`,
      `/api/vehicles/${bob.vehicleId}/fuel`,
      `/api/vehicles/${bob.vehicleId}/services`,
      `/api/services/${bob.serviceId}/attachments`,
      `/api/vehicles/${bob.vehicleId}/renewals`,
      `/api/vehicles/${bob.vehicleId}/renewals/status`,
    ];

    for (const path of readEndpoints) {
      const res = await call(path);
      expect([200, 404]).toContain(res.status);
      for (const marker of B_MARKERS) {
        expect(res.text, `${marker} leaked from GET ${path}`).not.toContain(marker);
      }
    }
  });

  /**
   * Receipts get their own test rather than riding on the sweep above.
   *
   * The sweep proves a marker string does not appear in a response body. An
   * attachment download is a PDF, and the marker is in its FILENAME -- so a
   * leak here could hand A the whole of B invoice while the sweep saw nothing
   * to complain about. The status code is the assertion that works on bytes.
   */
  it("never serves one garage the receipts of another", async () => {
    const call = as(A);

    // The bytes.
    expect((await call(`/api/attachments/${bob.attachmentId}/content`)).status).toBe(404);

    // The metadata, via B service record.
    const listing = await call(`/api/services/${bob.serviceId}/attachments`);
    expect(listing.status).toBe(404);

    // Attaching to B record.
    const upload = await call(`/api/services/${bob.serviceId}/attachments`, {
      method: "POST",
      form: filePart(pdfBytes("ALICE"), "ALICE_INTRUDER.pdf"),
    });
    expect(upload.status).toBe(404);

    // Deleting B receipt.
    expect((await call(`/api/attachments/${bob.attachmentId}`, { method: "DELETE" })).status).toBe(
      404,
    );

    // And B still has exactly the one receipt, unmodified. The 404s above do
    // not prove the writes were refused -- only reading B side back does.
    const bobs = await as(B)(`/api/services/${bob.serviceId}/attachments`);
    expect(bobs.status).toBe(200);
    expect(bobs.body).toHaveLength(1);
    expect(bobs.body[0].filename).toBe("BOB_RECEIPT_FILENAME.pdf");
    expect((await as(B)(`/api/attachments/${bob.attachmentId}/content`)).status).toBe(200);
  });

  it("404s rather than 403s on another garage's IDs", async () => {
    const call = as(A);
    // A 403 would confirm the row exists in someone else's garage, which is
    // itself the information we are protecting.
    expect((await call(`/api/vehicles/${bob.vehicleId}`)).status).toBe(404);
    expect((await call(`/api/vehicles/${bob.vehicleId}/services`)).status).toBe(404);
    expect((await call(`/api/vehicles/${bob.vehicleId}/renewals`)).status).toBe(404);
  });

  it("returns empty, not another garage's rows, from list endpoints", async () => {
    const call = as(A);
    const vehicles = await call("/api/vehicles");
    expect(vehicles.body).toHaveLength(1);
    expect(vehicles.body[0].nickname).toBe("ALICE_VEHICLE_NICKNAME");

    const maintenance = await call(`/api/vehicles/${bob.vehicleId}/maintenance`);
    expect(maintenance.body).toEqual([]);
  });

  it("shows only this garage's service templates", async () => {
    // Both users PUT a 'minor' template. A must see its own two parts, not
    // four, and not B's custom one.
    const res = await as(A)("/api/service-templates");
    const minor = res.body.filter(
      (r: { serviceType: string }) => r.serviceType === "minor",
    );
    expect(minor).toHaveLength(2);
    expect(minor.map((r: { partName: string }) => r.partName)).toContain(
      "ALICE_SPARE_PART",
    );
  });

  it("shows the global part types plus only this garage's custom ones", async () => {
    const res = await as(A)("/api/part-types");
    const names = res.body.map((r: { name: string }) => r.name);
    // The global seed rows are shared on purpose (garage_id IS NULL)...
    expect(names).toContain("Engine oil");
    expect(names).toContain("Timing chain");
    // ...the custom ones are not.
    expect(names).toContain("ALICE_SPARE_PART");
    expect(names).not.toContain("BOB_SPARE_PART");
  });

  it("does not suggest another garage's brands", async () => {
    // Autocomplete is a quiet leak route: it aggregates, so it looks like
    // reference data rather than someone else's records.
    const res = await as(A)("/api/part-types/pt_engine_oil/brands");
    expect(res.body.map((r: { brand: string }) => r.brand)).toEqual(["ALICE_BRAND"]);
  });

  describe("write path", () => {
    // Spec 5.3: reads are not the only exposure. An ID from the client is a
    // claim, not a fact, and a write that trusts it attaches A's records to
    // B's vehicle -- where the read path will then hide them from A.
    it("rejects writes against another garage's vehicle", async () => {
      const call = as(A);

      expect(
        (
          await call(`/api/vehicles/${bob.vehicleId}`, {
            method: "PATCH",
            json: { nickname: "hijacked" },
          })
        ).status,
      ).toBe(404);

      expect(
        (
          await call(`/api/vehicles/${bob.vehicleId}/odometer`, {
            method: "POST",
            json: { readingKm: 999_999, recordedOn: "2026-08-19" },
          })
        ).status,
      ).toBe(404);

      expect(
        (
          await call(`/api/vehicles/${bob.vehicleId}/services`, {
            method: "POST",
            json: { servicedOn: "2026-08-19", odometerKm: 60_000, items: [] },
          })
        ).status,
      ).toBe(404);

      expect(
        (
          await call(`/api/vehicles/${bob.vehicleId}/renewals`, {
            method: "POST",
            json: { type: "road_tax", expiresOn: "2027-01-01" },
          })
        ).status,
      ).toBe(404);

      expect(
        (await call(`/api/vehicles/${bob.vehicleId}`, { method: "DELETE" })).status,
      ).toBe(404);

      // setInterval creates a row when none exists, so this is an INSERT
      // against another garage's vehicle, not just a no-op UPDATE.
      expect(
        (
          await call(`/api/vehicles/${bob.vehicleId}/intervals/pt_timing_chain`, {
            method: "PATCH",
            json: { intervalKm: 150_000 },
          })
        ).status,
      ).toBe(404);
    });

    it("rejects another garage's part type as a line item or a template entry", async () => {
      const call = as(A);

      // A part type ID is exactly the kind of value that looks like harmless
      // reference data. Using B's would attach a row in A's garage that
      // points at B's row, and would leak B's part name back through every
      // join that resolves it.
      expect(
        (
          await call(`/api/vehicles/${alice.vehicleId}/services`, {
            method: "POST",
            json: {
              servicedOn: "2026-08-19",
              odometerKm: 60_000,
              items: [{ partTypeId: bob.partTypeId, quantityMilli: 1_000 }],
            },
          })
        ).status,
      ).toBe(404);

      expect(
        (
          await call("/api/service-templates/major", {
            method: "PUT",
            json: { partTypeIds: [bob.partTypeId] },
          })
        ).status,
      ).toBe(404);

      // ...and the rejected template write left the existing one intact.
      // put() deletes before it inserts, so a validation failure that landed
      // mid-batch would show up here as an emptied template rather than as
      // an error. The bootstrap seeds 'major' with five parts.
      const after = await call("/api/service-templates");
      expect(after.text).not.toContain("BOB_SPARE_PART");
      expect(
        after.body.filter((r: { serviceType: string }) => r.serviceType === "major"),
      ).toHaveLength(5);
    });

    it("rejects edits to another garage's records by ID", async () => {
      const call = as(A);

      // A COMPLETE body on purpose. Editing a service is a replacement, so a
      // partial one now fails validation -- and a 422 would satisfy nothing
      // this test is for. The 404 has to be proven to come from the tenant
      // check, not from Zod rejecting the payload before the check runs.
      expect(
        (
          await call(`/api/services/${bob.serviceId}`, {
            method: "PATCH",
            json: {
              servicedOn: "2026-08-19",
              odometerKm: 60_000,
              workshopName: "hijacked",
              items: [],
            },
          })
        ).status,
      ).toBe(404);

      expect(
        (await call(`/api/services/${bob.serviceId}`, { method: "DELETE" })).status,
      ).toBe(404);

      // Asserted HERE rather than in the "leaves B's data untouched" test
      // below, because resetDb runs beforeEach and that test cannot see a
      // write attempted in this one.
      //
      // Load-bearing: the 404 alone does not prove the edit was refused.
      // update() re-reads through list() to build its response, which
      // re-scopes and would 404 even if the UPDATE had already landed. Only
      // reading B's record back catches a write that succeeded before the
      // response failed.
      const bobsService = await as(B)(`/api/vehicles/${bob.vehicleId}/services`);
      expect(bobsService.body[0].workshopName).toBe("BOB_WORKSHOP");
      expect(bobsService.body[0].odometerKm).toBe(45_000);
      expect(bobsService.body[0].items).toHaveLength(1);

      expect(
        (
          await call(`/api/renewals/${bob.renewalId}`, {
            method: "PATCH",
            json: { provider: "hijacked" },
          })
        ).status,
      ).toBe(404);
    });

    it("leaves B's data untouched after every rejected write", async () => {
      const b = as(B);
      const vehicle = await b(`/api/vehicles/${bob.vehicleId}`);
      expect(vehicle.body.nickname).toBe("BOB_VEHICLE_NICKNAME");
      expect(vehicle.body.isActive).toBe(1);

      const services = await b(`/api/vehicles/${bob.vehicleId}/services`);
      expect(services.body).toHaveLength(1);
      expect(services.body[0].workshopName).toBe("BOB_WORKSHOP");
    });
  });

  it("shares global part types but not another garage's custom ones", async () => {
    // part_types is the one deliberate exception to the garage predicate:
    // garage_id IS NULL means shared. The exception must not widen.
    await env_insertCustomPartType(bob.vehicleId);
    const res = await as(A)("/api/part-types");
    const codes = res.body.map((p: { code: string }) => p.code);
    expect(codes).toContain("engine_oil");
    expect(codes).not.toContain("bob_custom_part");
  });

  it("keeps the garage predicate when the catalogue is narrowed by vehicle type", async () => {
    // ?vehicleType changes the JOIN, which is exactly the kind of edit that
    // loses a WHERE clause. B's custom part applies to both vehicle types, so
    // if the predicate were dropped it would surface here.
    await env_insertCustomPartType(bob.vehicleId);

    for (const type of ["car", "motorcycle"]) {
      const res = await as(A)(`/api/part-types?vehicleType=${type}`);
      expect(res.status).toBe(200);
      const codes = res.body.map((p: { code: string }) => p.code);
      expect(codes).not.toContain("bob_custom_part");
      expect(codes).toContain("engine_oil");
    }

    // Bike-only parts must not leak into the car catalogue either.
    const carOnly = await as(A)("/api/part-types?vehicleType=car");
    expect(carOnly.body.map((p: { code: string }) => p.code)).not.toContain("fork_oil");
  });
});

/** Inserts a garage-scoped part type for B, bypassing the API. */
async function env_insertCustomPartType(bobVehicleId: string): Promise<void> {
  const { env } = await import("cloudflare:test");
  const garage = await env.DB.prepare(`SELECT garage_id FROM vehicles WHERE id = ?`)
    .bind(bobVehicleId)
    .first<{ garage_id: string }>();
  // Two rows since 0008: a part type with no defaults row applies to no
  // vehicle type and would be invisible to the endpoint under test, which
  // would make this pass for the wrong reason.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO part_types (id, garage_id, code, name, category)
       VALUES ('pt_bob_custom', ?, 'bob_custom_part', 'BOB_CUSTOM', 'other')`,
    ).bind(garage!.garage_id),
    env.DB.prepare(
      `INSERT INTO part_type_defaults (part_type_id, vehicle_type, interval_km)
       VALUES ('pt_bob_custom','car',10000), ('pt_bob_custom','motorcycle',10000)`,
    ),
  ]);
}
