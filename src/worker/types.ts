export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
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
}

export interface AuthUser {
  email: string;
  name: string | null;
}

export type Status = "overdue" | "due_soon" | "ok" | "unknown";
