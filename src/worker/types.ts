export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  DEV_USER_EMAIL?: string;

  /**
   * Access team domain and application audience tag, used only to verify the
   * Cf-Access-Jwt-Assertion header when the runtime does not populate
   * ctx.access. See auth.ts. Both must be set for that fallback to engage;
   * with either missing, requests without a runtime identity are rejected.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export type Role = "owner" | "editor" | "viewer";

/**
 * Resolved once per request at the handler edge and handed to every
 * repository. Spec 5.1. Nothing reaches the database without one.
 */
export interface Scope {
  userId: string;
  garageId: string;
  role: Role;
  timezone: string;
  dueSoonDays: number;
  dueSoonKm: number;
}

export interface AuthUser {
  email: string;
  name: string | null;
}

export type Status = "overdue" | "due_soon" | "ok" | "unknown";
