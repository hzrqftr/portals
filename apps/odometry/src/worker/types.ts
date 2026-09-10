import type { CoreEnv } from "@portals/core/worker";

export interface Env extends CoreEnv {
  ASSETS: Fetcher;
  DEV_USER_EMAIL?: string;

  /**
   * Nightly whole-database export, written by the scheduled handler in
   * index.ts. Optional because `wrangler dev` and the test runner have no R2
   * binding -- the handler skips rather than throwing when it is absent, so a
   * missing bucket is a no-op locally instead of a broken dev server.
   *
   * This backs up BOTH portals: one D1, one export. It lives on this Worker
   * rather than Coinbox's because Coinbox is the app under active development,
   * and backup reliability should not ride on the deploy cadence of the thing
   * being changed. Table discovery is generic, so Coinbox adding tables never
   * requires redeploying this one.
   */
  BACKUPS?: R2Bucket;

  /**
   * User-uploaded documents -- service receipts today, whatever attaches next
   * after that. Bucket `portals-docs`, deliberately not the backup bucket.
   *
   * REQUIRED, unlike BACKUPS above, and the difference is not an oversight. A
   * nightly backup that skips when its binding is missing is a no-op nobody
   * notices until they need it. An UPLOAD that skips would return success to
   * someone who just attached their only copy of a workshop invoice. Making it
   * non-optional turns a missing binding into a type error here and a hard
   * failure at runtime, so tests/vitest.config.ts binds it too.
   */
  DOCS: R2Bucket;
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
