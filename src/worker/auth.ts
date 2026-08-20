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
 */
export async function getAuthenticatedUser(
  ctx: ExecutionContext,
  _env: Env,
): Promise<AuthUser> {
  const access = (ctx as ExecutionContext & { access?: AccessContext }).access;

  // undefined means the Worker is not behind Access. In production that is a
  // misconfiguration, not an anonymous visitor, and must fail closed.
  if (!access) throw new UnauthorizedError("Worker is not protected by Access");

  const identity = await access.getIdentity();
  if (!identity?.email) throw new UnauthorizedError();

  return { email: identity.email, name: identity.name ?? null };
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
            s.due_soon_km   AS due_soon_km
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
    }>();

  if (existing) {
    return {
      userId: existing.user_id,
      garageId: existing.garage_id,
      role: existing.role,
      timezone: existing.timezone,
      dueSoonDays: existing.due_soon_days ?? 30,
      dueSoonKm: existing.due_soon_km ?? 1000,
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
  ]);

  return {
    userId,
    garageId,
    role: "owner",
    timezone: "Asia/Kuala_Lumpur",
    dueSoonDays: 30,
    dueSoonKm: 1000,
  };
}

/** Writes require editor or owner. Spec 3. */
export function assertCanWrite(scope: Scope): void {
  if (scope.role === "viewer") {
    throw new UnauthorizedError("Viewers cannot modify data");
  }
}
