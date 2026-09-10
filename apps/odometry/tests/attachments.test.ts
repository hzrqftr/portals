import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb, pdfBytes, filePart } from "./helpers";
import { MAX_ATTACHMENT_BYTES } from "@portals/core/worker";
import { attachmentUpload } from "@shared/zod";

/**
 * Receipts attached to a service record (migration 0015).
 *
 * The cross-tenant half of this feature lives in isolation.test.ts, where it
 * belongs. What is here is everything else: that bytes survive the round trip,
 * that the limits actually reject, and that deleting a service takes its files
 * with it -- the last of which is invisible when broken, because the rows
 * cascade correctly while the objects quietly accumulate forever.
 */

const OWNER = "owner@example.com";

async function seedService(): Promise<{ vehicleId: string; serviceId: string }> {
  const req = as(OWNER);
  const vehicle = await req("/api/vehicles", {
    method: "POST",
    json: { nickname: "Test Car", plate: "TST 1", type: "car", currentOdometerKm: 50000 },
  });
  expect(vehicle.status).toBe(201);
  const vehicleId = vehicle.body.id;

  const service = await req(`/api/vehicles/${vehicleId}/services`, {
    method: "POST",
    json: { servicedOn: "2026-09-01", odometerKm: 50100, workshopName: "Test Workshop", items: [] },
  });
  expect(service.status).toBe(201);
  return { vehicleId, serviceId: service.body.id };
}

/** Every object currently in this test bucket. */
async function objectKeys(): Promise<string[]> {
  const listed = await env.DOCS.list();
  return listed.objects.map((o) => o.key).sort();
}

beforeAll(migrate);
beforeEach(async () => {
  await resetDb();
  // R2 is not covered by resetDb -- that wipes D1 only. Clear the bucket too,
  // or the object-count assertions below see the previous test uploads.
  for (const key of await objectKeys()) await env.DOCS.delete(key);
});

describe("uploading a receipt", () => {
  it("round-trips the exact bytes", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const bytes = pdfBytes("workshop-invoice-4471");

    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(bytes, "invoice.pdf"),
    });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      filename: "invoice.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.byteLength,
    });

    const list = await req(`/api/services/${serviceId}/attachments`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(up.body.id);

    const download = await req(`/api/attachments/${up.body.id}/content`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(download.bytes)).toEqual(bytes);
  });

  it("serves the download with the headers that stop it executing", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(pdfBytes(), "invoice.pdf"),
    });

    const download = await req(`/api/attachments/${up.body.id}/content`);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("content-disposition")).toBe('inline; filename="invoice.pdf"');
    expect(download.headers.get("cache-control")).toContain("private");
  });

  it("holds more than one receipt on one visit", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    for (const name of ["invoice.pdf", "parts-receipt.pdf", "tyres.pdf"]) {
      const up = await req(`/api/services/${serviceId}/attachments`, {
        method: "POST",
        form: filePart(pdfBytes(name), name),
      });
      expect(up.status).toBe(201);
    }
    const list = await req(`/api/services/${serviceId}/attachments`);
    expect(list.body.map((a: { filename: string }) => a.filename).sort()).toEqual([
      "invoice.pdf",
      "parts-receipt.pdf",
      "tyres.pdf",
    ]);
  });
});

describe("what is rejected", () => {
  /**
   * The one that matters. A file the client labels image/png whose bytes are
   * markup, served back from this Worker own origin, is script running with
   * the caller Access session. The declared type is not evidence.
   */
  it("refuses markup wearing an image content-type", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const html = new TextEncoder().encode("<script>alert(document.cookie)</script>");

    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(html, "totally-a-picture.png", "image/png"),
    });
    expect(up.status).toBe(422);
    expect(await objectKeys()).toEqual([]);
  });

  it("refuses a file over the size limit with 413, not 422", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const tooBig = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    tooBig.set(pdfBytes(), 0);

    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(tooBig, "huge.pdf"),
    });
    expect(up.status).toBe(413);
    expect(await objectKeys()).toEqual([]);
  });

  it("refuses an empty file", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(new Uint8Array(0), "nothing.pdf"),
    });
    expect(up.status).toBe(422);
  });

  it("refuses a request carrying no file at all", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: new FormData(),
    });
    expect(up.status).toBe(422);
  });

  it("caps the number of receipts on one record", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    for (let i = 0; i < 10; i++) {
      const up = await req(`/api/services/${serviceId}/attachments`, {
        method: "POST",
        form: filePart(pdfBytes(`n${i}`), `receipt-${i}.pdf`),
      });
      expect(up.status).toBe(201);
    }
    const eleventh = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(pdfBytes("n10"), "receipt-10.pdf"),
    });
    expect(eleventh.status).toBe(422);
    expect(await objectKeys()).toHaveLength(10);
  });

  /**
   * The filename is echoed in Content-Disposition, so a quote in it would end
   * the quoted string and let the rest of the name write header syntax. A
   * slash would let it masquerade as a path.
   *
   * Note what this test actually proved when it was written: the multipart
   * encoder percent-escapes a quote in transit, so the name arrives as
   * `pa%22sswd.pdf` and the sanitiser never sees a quote to strip. That is a
   * property of the transport, not a guarantee -- the schema is tested
   * directly below for the case where a literal quote does arrive.
   */
  it("strips path separators from the filename", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(pdfBytes(), '../../etc/pa"sswd.pdf'),
    });
    expect(up.status).toBe(201);
    expect(up.body.filename).not.toContain("/");
    expect(up.body.filename).not.toContain("..");
    expect(up.body.filename).not.toContain('"');

    // And it survives into the header it is echoed in.
    const download = await req(`/api/attachments/${up.body.id}/content`);
    const disposition = download.headers.get("content-disposition") ?? "";
    expect(disposition.match(/"/g) ?? []).toHaveLength(2);
  });
});

/**
 * Straight at the schema, because the multipart layer escapes some of these
 * before a request can carry them. The sanitiser is what stands between a
 * filename and a response header, so it is tested on the inputs it exists for
 * rather than only the ones a browser happens to send.
 */
describe("filename sanitising", () => {
  it("removes quotes, control characters and every kind of path", () => {
    const clean = (name: string) => attachmentUpload.parse({ filename: name }).filename;

    expect(clean('in"voice.pdf')).toBe("invoice.pdf");
    expect(clean("in\r\nvoice.pdf")).toBe("invoice.pdf");
    expect(clean("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(clean("C:\\Users\\me\\invoice.pdf")).toBe("invoice.pdf");
    expect(clean("  spaced.pdf  ")).toBe("spaced.pdf");
  });

  it("rejects a name that sanitises away to nothing", () => {
    expect(() => attachmentUpload.parse({ filename: '"""' })).toThrow();
    expect(() => attachmentUpload.parse({ filename: "   " })).toThrow();
  });
});

describe("deleting", () => {
  it("removes one attachment row and its object", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    const up = await req(`/api/services/${serviceId}/attachments`, {
      method: "POST",
      form: filePart(pdfBytes(), "invoice.pdf"),
    });
    expect(await objectKeys()).toHaveLength(1);

    const del = await req(`/api/attachments/${up.body.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    expect(await objectKeys()).toEqual([]);
    const list = await req(`/api/services/${serviceId}/attachments`);
    expect(list.body).toEqual([]);
    const gone = await req(`/api/attachments/${up.body.id}/content`);
    expect(gone.status).toBe(404);
  });

  /**
   * The invisible one. service_attachments rows cascade from service_records
   * (migration 0015), so the database looks right whether or not anyone
   * remembered the bucket. Only this assertion notices the difference.
   */
  it("takes the R2 objects with the service record", async () => {
    const req = as(OWNER);
    const { serviceId } = await seedService();
    for (const name of ["a.pdf", "b.pdf"]) {
      await req(`/api/services/${serviceId}/attachments`, {
        method: "POST",
        form: filePart(pdfBytes(name), name),
      });
    }
    expect(await objectKeys()).toHaveLength(2);

    const del = await req(`/api/services/${serviceId}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM service_attachments`).first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
    expect(await objectKeys()).toEqual([]);
  });
});
