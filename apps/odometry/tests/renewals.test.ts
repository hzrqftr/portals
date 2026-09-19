import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb, pdfBytes, filePart } from "./helpers";

/**
 * Renewals and the documents that hang off them and off the vehicle
 * (migration 0018). The cross-tenant half is in isolation.test.ts; this is
 * everything else.
 *
 * The receipts suite (attachments.test.ts) covers the shared machinery in
 * depth -- sniffing, size, filename sanitising. What is repeated here is only
 * what a per-owner configuration mistake would break: the right table, the
 * right parent, the cap, and that the bucket is cleaned when the parent goes.
 */

const OWNER = "owner@example.com";

async function seedVehicle(): Promise<string> {
  const res = await as(OWNER)("/api/vehicles", {
    method: "POST",
    json: {
      nickname: "Grant Car",
      plate: "GRT 1",
      vin: "PM2L251S002107437",
      engineNo: "3SZ-A123456",
      registeredOn: "2019-03-14",
      colour: "Silver",
      currentOdometerKm: 80_000,
    },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function addRenewal(vehicleId: string, body: Record<string, unknown>): Promise<string> {
  const res = await as(OWNER)(`/api/vehicles/${vehicleId}/renewals`, {
    method: "POST",
    json: body,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function objectKeys(): Promise<string[]> {
  const listed = await env.DOCS.list();
  return listed.objects.map((o) => o.key).sort();
}

beforeAll(migrate);
beforeEach(async () => {
  await resetDb();
  for (const key of await objectKeys()) await env.DOCS.delete(key);
});

describe("renewing", () => {
  it("inserts a new row, makes it active, and keeps the old one as history", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    await addRenewal(vehicleId, { type: "road_tax", expiresOn: "2026-03-01", cost: 9_000 });
    await addRenewal(vehicleId, { type: "road_tax", expiresOn: "2027-03-01", cost: 9_000 });

    const history = await req(`/api/vehicles/${vehicleId}/renewals`);
    expect(history.body.map((r: { expiresOn: string }) => r.expiresOn)).toEqual([
      "2027-03-01",
      "2026-03-01",
    ]);

    const status = await req(`/api/vehicles/${vehicleId}/renewals/status`);
    const roadTax = status.body.filter((r: { type: string }) => r.type === "road_tax");
    expect(roadTax).toHaveLength(1);
    expect(roadTax[0].expires_on).toBe("2027-03-01");
  });

  it("refuses to re-date a renewal, or to take an R2 key from the client", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const id = await addRenewal(vehicleId, { type: "insurance", expiresOn: "2027-01-01" });

    for (const json of [{ expiresOn: "2028-01-01" }, { cost: 1 }, { documentKey: "x/y.pdf" }]) {
      const res = await req(`/api/renewals/${id}`, { method: "PATCH", json });
      expect(res.status, JSON.stringify(json)).toBe(422);
    }

    // What IS correctable.
    const ok = await req(`/api/renewals/${id}`, {
      method: "PATCH",
      json: { provider: "Takaful Ikhlas", referenceNo: "P-123" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.expiresOn).toBe("2027-01-01");
  });

  /** Spec 6.3: a renewal type never entered is a setup prompt, not an alert. */
  it("raises no attention item for a type that was never entered", async () => {
    const vehicleId = await seedVehicle();
    const dash = await as(OWNER)("/api/dashboard");
    const renewalItems = dash.body.attention.filter(
      (a: { kind: string; vehicleId: string }) => a.kind === "renewal" && a.vehicleId === vehicleId,
    );
    expect(renewalItems).toEqual([]);
  });
});

describe("deleting a renewal entered by mistake", () => {
  /**
   * The reason delete exists. A mistyped LATER expiry is the greatest
   * expires_on, so it stays active and hides the real renewal. Deleting it
   * must hand "active" back to the row that is actually true.
   */
  it("hands 'active' back to the real renewal", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    await addRenewal(vehicleId, { type: "road_tax", expiresOn: "2027-03-01" });
    const typo = await addRenewal(vehicleId, { type: "road_tax", expiresOn: "2072-03-01" });

    let status = await req(`/api/vehicles/${vehicleId}/renewals/status`);
    expect(status.body.find((r: { type: string }) => r.type === "road_tax").expires_on).toBe(
      "2072-03-01",
    );

    expect((await req(`/api/renewals/${typo}`, { method: "DELETE" })).status).toBe(204);

    status = await req(`/api/vehicles/${vehicleId}/renewals/status`);
    expect(status.body.find((r: { type: string }) => r.type === "road_tax").expires_on).toBe(
      "2027-03-01",
    );
  });

  /**
   * Invisible when broken: renewal_attachments rows cascade, so the database
   * looks right whether or not anyone remembered the bucket.
   */
  it("takes its files out of R2 with it", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const id = await addRenewal(vehicleId, { type: "insurance", expiresOn: "2027-01-01" });
    for (const name of ["cover-note.pdf", "schedule.pdf"]) {
      const up = await req(`/api/renewals/${id}/attachments`, {
        method: "POST",
        form: filePart(pdfBytes(name), name),
      });
      expect(up.status).toBe(201);
    }
    expect(await objectKeys()).toHaveLength(2);

    expect((await req(`/api/renewals/${id}`, { method: "DELETE" })).status).toBe(204);

    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM renewal_attachments`).first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
    expect(await objectKeys()).toEqual([]);
  });
});

describe("renewal documents", () => {
  it("round-trips the bytes under a renewal-specific key", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const id = await addRenewal(vehicleId, { type: "insurance", expiresOn: "2027-01-01" });
    const bytes = pdfBytes("policy-schedule");

    const up = await req(`/api/renewals/${id}/attachments`, {
      method: "POST",
      form: filePart(bytes, "schedule.pdf"),
    });
    expect(up.status).toBe(201);

    const [key] = await objectKeys();
    expect(key).toContain(`/renewal/${id}/`);

    const download = await req(`/api/renewal-attachments/${up.body.id}/content`);
    expect(download.status).toBe(200);
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(download.bytes)).toEqual(bytes);
  });

  it("refuses markup wearing an image content-type", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const id = await addRenewal(vehicleId, { type: "insurance", expiresOn: "2027-01-01" });
    const up = await req(`/api/renewals/${id}/attachments`, {
      method: "POST",
      form: filePart(new TextEncoder().encode("<svg onload=alert(1)>"), "x.png", "image/png"),
    });
    expect(up.status).toBe(422);
    expect(await objectKeys()).toEqual([]);
  });

  /** A receipt id must not open through the renewal route, nor the reverse. */
  it("keeps each owner's ids to its own routes", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const id = await addRenewal(vehicleId, { type: "insurance", expiresOn: "2027-01-01" });
    const up = await req(`/api/renewals/${id}/attachments`, {
      method: "POST",
      form: filePart(pdfBytes(), "a.pdf"),
    });
    expect((await req(`/api/attachments/${up.body.id}/content`)).status).toBe(404);
    expect((await req(`/api/grant-documents/${up.body.id}/content`)).status).toBe(404);
  });
});

describe("the vehicle grant", () => {
  it("stores the grant's vehicle details, and nothing about the owner", async () => {
    const vehicleId = await seedVehicle();
    const res = await as(OWNER)(`/api/vehicles/${vehicleId}`);
    expect(res.body).toMatchObject({
      vin: "PM2L251S002107437",
      engineNo: "3SZ-A123456",
      registeredOn: "2019-03-14",
      colour: "Silver",
    });

    // Owner decision, 2026-09-19: name, IC and address live only in the PDF.
    // If a column for any of them is ever added, this is where to argue it.
    const cols = await env.DB.prepare(`SELECT name FROM pragma_table_info('vehicles')`).all<{
      name: string;
    }>();
    const names = cols.results.map((c) => c.name);
    for (const forbidden of ["owner_name", "owner_ic", "ic_no", "owner_address", "address"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("can clear a grant field", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const res = await req(`/api/vehicles/${vehicleId}`, {
      method: "PATCH",
      json: { colour: null, registeredOn: "2019-03-15" },
    });
    expect(res.status).toBe(200);
    expect(res.body.colour).toBeNull();
    expect(res.body.registeredOn).toBe("2019-03-15");
  });

  it("round-trips the PDF and caps the number of files", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const bytes = pdfBytes("geran");

    const first = await req(`/api/vehicles/${vehicleId}/grant`, {
      method: "POST",
      form: filePart(bytes, "geran.pdf"),
    });
    expect(first.status).toBe(201);
    const download = await req(`/api/grant-documents/${first.body.id}/content`);
    expect(new Uint8Array(download.bytes)).toEqual(bytes);

    for (let i = 1; i < 5; i++) {
      const up = await req(`/api/vehicles/${vehicleId}/grant`, {
        method: "POST",
        form: filePart(pdfBytes(`p${i}`), `page-${i}.pdf`),
      });
      expect(up.status).toBe(201);
    }
    const sixth = await req(`/api/vehicles/${vehicleId}/grant`, {
      method: "POST",
      form: filePart(pdfBytes("p6"), "page-6.pdf"),
    });
    expect(sixth.status).toBe(422);
    expect(await objectKeys()).toHaveLength(5);

    const row = await env.DB.prepare(`SELECT DISTINCT kind FROM vehicle_documents`).all<{
      kind: string;
    }>();
    expect(row.results).toEqual([{ kind: "grant" }]);
  });

  it("deletes one grant file and its object", async () => {
    const req = as(OWNER);
    const vehicleId = await seedVehicle();
    const up = await req(`/api/vehicles/${vehicleId}/grant`, {
      method: "POST",
      form: filePart(pdfBytes(), "geran.pdf"),
    });
    expect((await req(`/api/grant-documents/${up.body.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect(await objectKeys()).toEqual([]);
    expect((await req(`/api/vehicles/${vehicleId}/grant`)).body).toEqual([]);
  });
});
