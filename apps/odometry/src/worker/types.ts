import type { CoreEnv } from "@portals/core/worker";

export interface Env extends CoreEnv {
  ASSETS: Fetcher;
  DEV_USER_EMAIL?: string;
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
  /** Divisor in the km->date projection. Guaranteed >= 1 by settingsPatch. */
  fallbackKmPerDay: number;
  staleOdometerDays: number;
}

export type Status = "overdue" | "due_soon" | "ok" | "unknown";
