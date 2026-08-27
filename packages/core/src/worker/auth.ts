import type { CoreEnv, AuthUser } from "./types";
import { UnauthorizedError } from "./errors";

/**
 * THE ONLY PLACE IN THE CODEBASE THAT TOUCHES CLOUDFLARE ACCESS.
 * CLAUDE.md invariant 3, spec 11.1.
 *
 * Access is an allowlist and cannot do self-service signup. If this project
 * ever wants public registration, Access is replaced entirely -- and that is
 * a one-file change only for as long as no other file calls getIdentity().
 * Do not call ctx.access anywhere else, however convenient it looks.
 *
 * Note on local development: the spec (2.3) predates Worker-level Access and
 * describes an `env.ENVIRONMENT === "development"` branch. That branch no
 * longer exists, because wrangler.jsonc's `access.dev` block now supplies a
 * simulated identity locally. getIdentity() behaves identically in dev and
 * production, so there is no dev-only code path that could ever be reachable
 * in production -- the risk the invariant was written to prevent is gone
 * rather than merely guarded.
 *
 * Two identity sources, in preference order:
 *
 *   1. ctx.access, populated by the runtime. Cheap, and the signature has
 *      already been checked for us.
 *   2. The `Cf-Access-Jwt-Assertion` header, verified here against the team's
 *      published signing keys.
 *
 * (2) exists because on 2026-08-20 this Worker was protected by a correctly
 * configured Worker-attached Access application -- requests arrived carrying a
 * valid assertion header -- and yet the runtime did not populate ctx.access.
 * Verifying the assertion ourselves is what Workers did before ctx.access
 * existed, so it is well-trodden rather than a novel workaround. If Cloudflare
 * starts populating ctx.access, path (1) silently takes over again and this
 * code stops running; delete it then.
 *
 * Both paths fail closed. Neither trusts `Cf-Access-Authenticated-User-Email`,
 * which is an unsigned header and forgeable by anyone who can reach the Worker
 * without traversing Access.
 */
export async function getAuthenticatedUser(
  ctx: ExecutionContext,
  env: CoreEnv,
  request: Request,
): Promise<AuthUser> {
  const access = (ctx as ExecutionContext & { access?: AccessContext }).access;

  if (access) {
    const identity = await access.getIdentity();
    if (!identity?.email) throw new UnauthorizedError();
    return { email: identity.email, name: identity.name ?? null };
  }

  return identityFromAssertion(env, request);
}

/** Cache of the team's signing keys. Isolate-local; rebuilt on cold start. */
let jwksCache: { url: string; expiresAt: number; keys: Map<string, JsonWebKey> } | null = null;

const JWKS_TTL_MS = 60 * 60 * 1000;

/** Tolerance for clock drift between Cloudflare's signer and this isolate. */
const CLOCK_SKEW_SECONDS = 60;

async function loadJwks(teamDomain: string, force: boolean): Promise<Map<string, JsonWebKey>> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const now = Date.now();

  if (!force && jwksCache && jwksCache.url === url && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const res = await fetch(url);
  if (!res.ok) throw new UnauthorizedError("Could not load Access signing keys");

  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const keys = new Map<string, JsonWebKey>();
  for (const key of body.keys ?? []) {
    if (key.kid) keys.set(key.kid, key);
  }

  jwksCache = { url, expiresAt: now + JWKS_TTL_MS, keys };
  return keys;
}

async function verificationKey(teamDomain: string, kid: string): Promise<CryptoKey> {
  let jwk = (await loadJwks(teamDomain, false)).get(kid);

  // A kid we have never seen usually means Access rotated its keys, not that
  // the token is forged. Refetch once before rejecting.
  if (!jwk) jwk = (await loadJwks(teamDomain, true)).get(kid);
  if (!jwk) throw new UnauthorizedError("Unknown Access signing key");

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

// Explicitly ArrayBuffer-backed: crypto.subtle rejects a possibly-shared
// buffer, and `new Uint8Array(n)` alone widens to ArrayBufferLike.
function base64UrlToBytes(segment: string): Uint8Array<ArrayBuffer> {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

interface AccessJwtHeader {
  alg?: string;
  kid?: string;
}

interface AccessJwtPayload {
  aud?: string[] | string;
  iss?: string;
  email?: string;
  name?: string;
  exp?: number;
  nbf?: number;
}

/**
 * Verifies the Access assertion. Every failure returns the same bare 401: a
 * more specific message would tell an attacker which check they tripped.
 */
async function identityFromAssertion(env: CoreEnv, request: Request): Promise<AuthUser> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const expectedAud = env.ACCESS_AUD;

  // Not configured and no runtime identity: the Worker is unprotected, which
  // is a misconfiguration rather than an anonymous visitor. Fail closed.
  if (!teamDomain || !expectedAud) {
    throw new UnauthorizedError("Worker is not protected by Access");
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new UnauthorizedError("Worker is not protected by Access");

  const [headerSegment, payloadSegment, signatureSegment, ...rest] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment || rest.length > 0) {
    throw new UnauthorizedError();
  }

  const header = decodeSegment<AccessJwtHeader>(headerSegment);
  // Pinned to the algorithm Access actually signs with. Accepting whatever the
  // token declares is how "alg: none" and HMAC-confusion attacks get in.
  if (header.alg !== "RS256" || !header.kid) throw new UnauthorizedError();

  const key = await verificationKey(teamDomain, header.kid);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  if (!verified) throw new UnauthorizedError();

  const payload = decodeSegment<AccessJwtPayload>(payloadSegment);

  // A signature alone is not enough: without the aud check, a valid token
  // minted for any other Access application on this team would be accepted.
  const audiences = Array.isArray(payload.aud)
    ? payload.aud
    : payload.aud
      ? [payload.aud]
      : [];
  if (!audiences.includes(expectedAud)) throw new UnauthorizedError();
  if (payload.iss !== `https://${teamDomain}`) throw new UnauthorizedError();

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new UnauthorizedError();
  }
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new UnauthorizedError();
  }

  if (!payload.email) throw new UnauthorizedError();

  // The assertion carries email but not always a display name; ctx.access does.
  // A null name is already expected here -- users.display_name is nullable.
  return { email: payload.email, name: payload.name ?? null };
}

interface AccessContext {
  aud: string;
  getIdentity(): Promise<AccessIdentity | null>;
}

interface AccessIdentity {
  email?: string;
  name?: string;
  groups?: string[];
}
