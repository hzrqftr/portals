import { env, applyD1Migrations } from "cloudflare:test";
import app from "@worker/index";

/**
 * Drives the real Worker -- real middleware, real auth, real repositories,
 * real D1 -- with a chosen Access identity.
 *
 * The identity seam is the ExecutionContext. In production Cloudflare
 * populates ctx.access; here the test does. Nothing else is stubbed, so a
 * missing garage predicate anywhere in the stack shows up in these tests
 * exactly as it would in production.
 */
export function as(email: string) {
  const ctx = {
    access: {
      aud: "test",
      getIdentity: async () => ({ email, name: email.split("@")[0] }),
    },
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;

  return async function request(
    path: string,
    init?: RequestInit & { json?: unknown; form?: FormData },
  ): Promise<{ status: number; body: any; text: string; bytes: ArrayBuffer; headers: Headers }> {
    const { json, form, ...rest } = init ?? {};
    // `form` sets no content-type header on purpose: the runtime derives the
    // multipart boundary, and supplying one by hand produces a body the server
    // cannot parse. The client has the same trap -- see api() in
    // packages/core/src/client/api.ts.
    const req = new Request(`https://fleet.test${path}`, {
      ...rest,
      ...(form !== undefined ? { body: form } : {}),
      ...(json !== undefined
        ? {
            body: JSON.stringify(json),
            headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
          }
        : {}),
    });
    const res = await app.fetch(req, env as never, ctx);
    const headers = res.headers;
    // Read once, as bytes, then decode. Attachment downloads are binary and a
    // .text() on them would corrupt what the assertions compare.
    const bytes = await res.arrayBuffer();
    const text = new TextDecoder().decode(bytes);
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body, text, bytes, headers };
  };
}

export async function migrate(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      DOCS: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

interface D1Migration {
  name: string;
  queries: string[];
}

/**
 * Wipes tenant data between tests, keeping the schema and the global part
 * type seed set.
 *
 * The pool's storage isolation is not relied on here. These tests assert on
 * exact row counts -- "A sees one vehicle, not two" is the whole point -- and
 * a suite whose correctness depends on someone else's cleanup semantics is
 * one runner upgrade away from passing for the wrong reason.
 *
 * Order matters: children before parents, since foreign keys are on.
 */
export async function resetDb(): Promise<void> {
  const tables = [
    // Child of BOTH transactions and odometer_readings, and a fill with a
    // null transaction_id cascades from neither. It goes first.
    "fuel_fills",
    "service_items",
    // Child of service_records. Before its parent, like service_items -- and
    // note the R2 objects these rows point at are NOT cleaned up here; each
    // test's bucket is its own, so they vanish with it.
    "service_attachments",
    "service_records",
    "odometer_readings",
    "maintenance_intervals",
    // References garages, vehicles and part_types, so it goes before all
    // three -- and before the part_types delete below.
    "service_templates",
    "renewals",
    "cost_estimates",
    "vehicles",
    "garage_members",
    "user_settings",
    "garages",
    "users",
  ];
  await env.DB.batch([
    ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    // Garage-scoped custom part types go; the global seed set stays.
    env.DB.prepare(`DELETE FROM part_types WHERE garage_id IS NOT NULL`),
  ]);
}

/**
 * The smallest byte sequence that sniffs as a PDF, with a distinguishable
 * payload so a round trip can be compared exactly.
 *
 * A real PDF is not needed: nothing in this system parses one. What IS needed
 * is a leading "%PDF-", because the upload path derives the stored content
 * type from the bytes rather than from anything the client claims.
 */
export function pdfBytes(marker = "receipt"): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4
${marker}
%%EOF
`);
}

export function filePart(bytes: Uint8Array, filename: string, declaredType = "application/pdf") {
  const form = new FormData();
  form.set("file", new File([bytes as BufferSource], filename, { type: declaredType }));
  return form;
}
