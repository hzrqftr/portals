import { eq, desc } from "drizzle-orm";
import { GarageScopedRepo } from "./base";
import { renewals } from "../schema";
import { NotFoundError } from "@portals/core/worker";
import type { RenewalInput, RenewalPatch } from "@shared/zod";

/**
 * Renewals are immutable historical records. CLAUDE.md invariant 8, spec 4.6.
 *
 * Renewing road tax INSERTs a new row. It never updates the old one, because
 * the sequence of past costs is what the forecast is built from -- overwrite
 * last year's premium with this year's and the trend it was supposed to show
 * is gone, silently and unrecoverably.
 */
export class RenewalRepo extends GarageScopedRepo {
  /** Full history for a vehicle, newest expiry first. */
  async list(vehicleId: string) {
    await this.assertOwnedVehicle(vehicleId);
    return this.db
      .select()
      .from(renewals)
      .where(this.where(renewals, eq(renewals.vehicleId, vehicleId)))
      .orderBy(desc(renewals.expiresOn));
  }

  async create(vehicleId: string, input: RenewalInput) {
    await this.assertOwnedVehicle(vehicleId);
    const id = crypto.randomUUID();
    await this.raw
      .prepare(
        `INSERT INTO renewals
           (id, garage_id, vehicle_id, type, provider, reference_no,
            issued_on, expires_on, cost, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        this.garageId,
        vehicleId,
        input.type,
        input.provider ?? null,
        input.referenceNo ?? null,
        input.issuedOn ?? null,
        input.expiresOn,
        input.cost ?? null,
        input.notes ?? null,
      )
      .run();
    return id;
  }

  /**
   * Corrections only.
   *
   * The API surface in spec 7 lists PATCH /api/renewals/:id, which sits
   * awkwardly next to "renewals are immutable". The reconciliation is that
   * this exists to fix a typo in a policy number, not to re-date a policy.
   * `expires_on`, `issued_on`, `type` and `cost` are absent from RenewalPatch
   * in src/shared/zod, so the Zod schema rejects them at the boundary before
   * this method is ever reached. Correcting an expiry means inserting the
   * renewal you actually hold.
   */
  async update(id: string, patch: RenewalPatch) {
    const [row] = await this.db
      .update(renewals)
      .set(patch)
      .where(this.where(renewals, eq(renewals.id, id)))
      .returning();
    if (!row) throw new NotFoundError("Renewal not found");
    return row;
  }
}
