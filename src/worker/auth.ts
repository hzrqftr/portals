import type { Env, AuthUser, Scope, Role } from "./types";
import { UnauthorizedError } from "./errors";
import { nowIso } from "@shared/dates";

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
  env: Env,
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
async function identityFromAssertion(env: Env, request: Request): Promise<AuthUser> {
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

/**
 * Resolves the request scope, creating the user, their personal garage and
 * their owner membership on first sight. Spec 3.
 *
 * Identity is keyed on email because that is what Access verifies; it does
 * not supply a stable opaque ID. A user who changes email becomes a new user
 * with an empty garage. Acceptable at this scale, but it is a real property
 * of the system, not an oversight.
 */
export async function resolveScope(env: Env, user: AuthUser): Promise<Scope> {
  const existing = await env.DB.prepare(
    `SELECT u.id            AS user_id,
            u.timezone      AS timezone,
            gm.garage_id    AS garage_id,
            gm.role         AS role,
            s.due_soon_days AS due_soon_days,
            s.due_soon_km   AS due_soon_km,
            s.fallback_km_per_day AS fallback_km_per_day,
            s.stale_odometer_days AS stale_odometer_days
       FROM users u
       JOIN garage_members gm ON gm.user_id = u.id
       LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.email = ?
      ORDER BY gm.role = 'owner' DESC
      LIMIT 1`,
  )
    .bind(user.email)
    .first<{
      user_id: string;
      timezone: string;
      garage_id: string;
      role: Role;
      due_soon_days: number | null;
      due_soon_km: number | null;
      fallback_km_per_day: number | null;
      stale_odometer_days: number | null;
    }>();

  if (existing) {
    return {
      userId: existing.user_id,
      garageId: existing.garage_id,
      role: existing.role,
      timezone: existing.timezone,
      dueSoonDays: existing.due_soon_days ?? 30,
      dueSoonKm: existing.due_soon_km ?? 1000,
      // The LEFT JOIN means a user with no settings row yields NULLs here.
      // A NULL fallback rate would divide by zero in the km projection, so
      // the coalesce is load-bearing, not defensive noise.
      fallbackKmPerDay: existing.fallback_km_per_day ?? 30,
      staleOdometerDays: existing.stale_odometer_days ?? 45,
    };
  }

  return bootstrapUser(env, user);
}

async function bootstrapUser(env: Env, user: AuthUser): Promise<Scope> {
  const userId = crypto.randomUUID();
  const garageId = crypto.randomUUID();
  const createdAt = nowIso();

  // D1 has no interactive transactions. batch() is atomic: either every
  // statement lands or none does, so a half-created user cannot exist.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`,
    ).bind(userId, user.email, user.name, createdAt),
    env.DB.prepare(
      `INSERT INTO garages (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(garageId, "My Garage", userId, createdAt),
    env.DB.prepare(
      `INSERT INTO garage_members (garage_id, user_id, role) VALUES (?, ?, 'owner')`,
    ).bind(garageId, userId),
    env.DB.prepare(
      `INSERT INTO user_settings (user_id) VALUES (?)`,
    ).bind(userId),

    // Starter parts templates for the two service types that have a
    // conventional shape. They are only a pre-fill -- the log-service form
    // lets any of it be removed -- and Settings edits them. Seeding here
    // rather than in the migration keeps them per-garage and editable,
    // instead of a global set every garage would fight with.
    env.DB.prepare(
      `INSERT INTO service_templates
         (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
       VALUES
         (lower(hex(randomblob(16))), ?, NULL, 'minor', 'pt_engine_oil',   0),
         (lower(hex(randomblob(16))), ?, NULL, 'minor', 'pt_oil_filter',   1),
         (lower(hex(randomblob(16))), ?, NULL, 'major', 'pt_engine_oil',   0),
         (lower(hex(randomblob(16))), ?, NULL, 'major', 'pt_oil_filter',   1),
         (lower(hex(randomblob(16))), ?, NULL, 'major', 'pt_air_filter',   2),
         (lower(hex(randomblob(16))), ?, NULL, 'major', 'pt_cabin_filter', 3),
         (lower(hex(randomblob(16))), ?, NULL, 'major', 'pt_brake_fluid',  4)`,
    ).bind(garageId, garageId, garageId, garageId, garageId, garageId, garageId),
  ]);

  return {
    userId,
    garageId,
    role: "owner",
    timezone: "Asia/Kuala_Lumpur",
    dueSoonDays: 30,
    dueSoonKm: 1000,
    fallbackKmPerDay: 30,
    staleOdometerDays: 45,
  };
}

/** Writes require editor or owner. Spec 3. */
export function assertCanWrite(scope: Scope): void {
  if (scope.role === "viewer") {
    throw new UnauthorizedError("Viewers cannot modify data");
  }
}
