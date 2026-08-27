import type { Env, Scope, Role } from "./types";
import { type AuthUser, UnauthorizedError } from "@portals/core/worker";
import { nowIso } from "@portals/core";

/**
 * Odometry's ownership axis: a GARAGE.
 *
 * Identity comes from `getAuthenticatedUser()` in @portals/core -- the only
 * thing in either portal that touches Cloudflare Access. What that identity
 * is then allowed to see is a per-portal question, and this file is
 * Odometry's answer to it.
 *
 * The garage indirection exists so a household can share one fleet. Coinbox
 * deliberately does NOT reuse it: adding someone to your garage so they can
 * see service schedules must never expose your ledger. See
 * apps/coinbox/src/worker/scope.ts for the other axis.
 */

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
