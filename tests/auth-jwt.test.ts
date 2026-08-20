import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { env } from "cloudflare:test";
import app from "@worker/index";
import { migrate } from "./helpers";

/**
 * The Cf-Access-Jwt-Assertion fallback in auth.ts.
 *
 * This path only runs when the runtime does not populate ctx.access, which is
 * exactly the situation in which nothing else is checking the caller. Every
 * case below is a way in that must stay shut, so each one asserts 401 rather
 * than merely "not 200" -- a 500 from a thrown parser would also be "not 200"
 * while meaning something entirely different.
 */

const TEAM_DOMAIN = "fleet.cloudflareaccess.test";
const AUD = "test-aud-tag";
const KID = "test-key-1";

let signingKey: CryptoKey;
let otherSigningKey: CryptoKey;
let realFetch: typeof globalThis.fetch;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeSegment(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: [AUD],
    iss: `https://${TEAM_DOMAIN}`,
    email: "owner@example.com",
    exp: now + 3600,
    iat: now,
    nbf: now - 10,
    ...overrides,
  };
}

async function sign(
  key: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" },
): Promise<string> {
  const headerSegment = encodeSegment(header);
  const payloadSegment = encodeSegment(payload);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  return `${headerSegment}.${payloadSegment}.${b64url(new Uint8Array(signature))}`;
}

/** No `access` property: this is the production situation being reproduced. */
function ctxWithoutAccess(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

async function get(token?: string): Promise<{ status: number; body: unknown }> {
  const headers = token ? { "cf-access-jwt-assertion": token } : undefined;
  const res = await app.fetch(
    new Request("https://fleet.test/api/dashboard", { headers }),
    env as never,
    ctxWithoutAccess(),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await migrate();

  const pair = await generateKeyPair();
  const otherPair = await generateKeyPair();
  signingKey = pair.privateKey;
  otherSigningKey = otherPair.privateKey;

  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey & {
    kid?: string;
  };
  jwk.kid = KID;

  // Stand in for https://<team>/cdn-cgi/access/certs. Any other URL falls
  // through, so an accidental real network call still fails loudly.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("Access assertion fallback", () => {
  it("accepts a correctly signed assertion and bootstraps the user", async () => {
    const { status, body } = await get(await sign(signingKey, validPayload()));

    expect(status).toBe(200);
    expect(body).toMatchObject({ vehicles: [], attention: [] });

    const row = await env.DB.prepare("SELECT email FROM users WHERE email = ?")
      .bind("owner@example.com")
      .first<{ email: string }>();
    expect(row?.email).toBe("owner@example.com");
  });

  it("rejects a request with no assertion header", async () => {
    const { status, body } = await get();
    expect(status).toBe(401);
    expect(body).toMatchObject({ message: "Worker is not protected by Access" });
  });

  it("rejects a token signed by a different key", async () => {
    const { status } = await get(await sign(otherSigningKey, validPayload()));
    expect(status).toBe(401);
  });

  it("rejects a tampered payload", async () => {
    const token = await sign(signingKey, validPayload());
    const [header, , signature] = token.split(".");
    const forged = encodeSegment(validPayload({ email: "attacker@example.com" }));

    const { status } = await get(`${header}.${forged}.${signature}`);
    expect(status).toBe(401);
  });

  it("rejects a token minted for another Access application", async () => {
    const { status } = await get(await sign(signingKey, validPayload({ aud: ["someone-elses-app"] })));
    expect(status).toBe(401);
  });

  it("rejects a token from another team", async () => {
    const { status } = await get(
      await sign(signingKey, validPayload({ iss: "https://evil.cloudflareaccess.com" })),
    );
    expect(status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = Math.floor(Date.now() / 1000) - 3600;
    const { status } = await get(await sign(signingKey, validPayload({ exp: expired })));
    expect(status).toBe(401);
  });

  it("rejects a token that is not yet valid", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const { status } = await get(await sign(signingKey, validPayload({ nbf: future })));
    expect(status).toBe(401);
  });

  it("rejects an unsigned token claiming alg none", async () => {
    const header = encodeSegment({ alg: "none", kid: KID, typ: "JWT" });
    const payload = encodeSegment(validPayload());

    const { status } = await get(`${header}.${payload}.`);
    expect(status).toBe(401);
  });

  it("rejects a token with no email claim", async () => {
    const payload = validPayload();
    delete payload.email;
    const { status } = await get(await sign(signingKey, payload));
    expect(status).toBe(401);
  });

  it("rejects a malformed token", async () => {
    expect((await get("not-a-jwt")).status).toBe(401);
    expect((await get("a.b")).status).toBe(401);
  });
});
