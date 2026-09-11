import { eq, desc } from "drizzle-orm";
import { GarageScopedRepo } from "./base";
import { serviceItems } from "../schema";
import {
  NotFoundError,
  assertReadingNotBackwards,
  deleteAttachments,
  odometerUpdateStatement,
  odometerWriteStatements,
  recacheOdometerStatement,
} from "@portals/core/worker";
import { nowIso } from "@portals/core";
import type { Env, Scope } from "../types";
import type { ServiceInput, ServiceUpdate, ServiceType } from "@shared/zod";

export class ServiceRepo extends GarageScopedRepo {
  /**
   * Takes the whole env for one reason: deleting a service has to delete the
   * receipts attached to it from R2, and only D1 knows how to cascade.
   */
  private readonly docs: R2Bucket;
  constructor(
    db: ConstructorParameters<typeof GarageScopedRepo>[0],
    raw: D1Database,
    scope: Scope,
    env: Env,
  ) {
    super(db, raw, scope);
    this.docs = env.DOCS;
  }

  async list(vehicleId: string) {
    await this.assertOwnedVehicle(vehicleId);

    // One query with a join, not one query per record to fetch its items.
    const { results } = await this.raw
      .prepare(
        `SELECT sr.id, sr.serviced_on, sr.odometer_km, sr.service_type,
                sr.workshop_name, sr.labour_cost, sr.notes, sr.created_at,
                -- The grand total, computed rather than stored. A correlated
                -- subquery instead of SUM() over the join, because the join
                -- repeats the record once per line item and a plain SUM would
                -- multiply the parts by the number of rows.
                --
                -- NULLIF keeps "nothing recorded" distinct from "recorded as
                -- free": a visit with no costs entered shows a blank total,
                -- not RM 0.00.
                NULLIF(COALESCE(sr.labour_cost, 0) + COALESCE(
                  (SELECT SUM(i.line_total_cost)
                     FROM service_items i
                    WHERE i.service_record_id = sr.id
                      AND i.garage_id = sr.garage_id), 0), 0) AS total_cost,
                (SELECT SUM(i.line_total_cost)
                   FROM service_items i
                  WHERE i.service_record_id = sr.id
                    AND i.garage_id = sr.garage_id) AS parts_cost,
                si.id AS item_id, si.part_type_id, pt.name AS part_name,
                si.brand, si.spec, si.note, si.quantity_milli, si.unit_cost,
                si.line_total_cost, si.warranty_months,
                si.interval_km_override, si.interval_months_override,
                -- Warranty expiry is derived here rather than stored, for the
                -- same reason due dates are: it is a function of the service
                -- date and the term, and correcting either must move it.
                -- Display only -- no status band, no attention item.
                CASE WHEN si.warranty_months IS NOT NULL
                     THEN date(sr.serviced_on, '+' || si.warranty_months || ' months')
                END AS warranty_expires_on,
                -- The absolute figure the owner typed, reconstructed from the
                -- interval that was actually stored.
                CASE WHEN si.interval_km_override IS NOT NULL
                     THEN sr.odometer_km + si.interval_km_override
                END AS next_due_km
           FROM service_records sr
           LEFT JOIN service_items si ON si.service_record_id = sr.id
           LEFT JOIN part_types pt ON pt.id = si.part_type_id
          WHERE sr.garage_id = ? AND sr.vehicle_id = ?
          ORDER BY sr.serviced_on DESC, sr.id, pt.name`,
      )
      .bind(this.garageId, vehicleId)
      .all<ServiceJoinRow>();

    return groupItems(results);
  }

  /**
   * Creates a service record, its line items, and the odometer reading the
   * visit implies -- one atomic batch. Spec 8.4.
   *
   * Every part_type_id is checked against the caller's garage first. Spec 5.3:
   * an ID arriving from the client is a claim, not a fact.
   */
  async create(vehicleId: string, input: ServiceInput) {
    await this.assertOwnedVehicle(vehicleId);
    for (const item of input.items) {
      await this.assertUsablePartType(item.partTypeId);
    }

    const recordId = crypto.randomUUID();
    const ts = nowIso();

    const statements: D1PreparedStatement[] = [
      this.raw
        .prepare(
          `INSERT INTO service_records
             (id, garage_id, vehicle_id, serviced_on, odometer_km, service_type,
              workshop_name, labour_cost, notes, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          recordId,
          this.garageId,
          vehicleId,
          input.servicedOn,
          input.odometerKm,
          // A label only. Whether any clock resets is decided entirely by the
          // line items below (invariant 7): a "major" with no items resets
          // nothing, and that is the correct outcome, not a bug to paper over.
          input.serviceType ?? null,
          input.workshopName ?? null,
          input.labourCost ?? null,
          input.notes ?? null,
          ts,
        ),
    ];

    statements.push(...this.itemStatements(recordId, vehicleId, input.items));

    // The visit implies a reading. Shared with Odometry's quick odometer update
    // and with Coinbox's fuel entry -- see @portals/core/worker/odometer.ts,
    // which also explains why the cache update is guarded on the DATE.
    const readingId = crypto.randomUUID();
    statements.push(
      ...odometerWriteStatements(this.raw, {
        readingId,
        garageId: this.garageId,
        vehicleId,
        readingKm: input.odometerKm,
        recordedOn: input.servicedOn,
        source: "service",
      }),
      // The link that makes update() below possible (migration 0014). Written
      // in the same batch as the reading, so a service can never exist
      // pointing at a reading that was not created.
      this.raw
        .prepare(
          `UPDATE service_records SET odometer_reading_id = ?
            WHERE id = ? AND garage_id = ?`,
        )
        .bind(readingId, recordId, this.garageId),
    );

    await this.raw.batch(statements);
    return recordId;
  }

  /**
   * Corrects a service visit. Spec 8.4.
   *
   * A REPLACEMENT, not a merge -- see `serviceUpdate` in @shared/zod for why
   * the line items force that. The three things worth understanding:
   *
   * 1. THE ODOMETER MOVES THREE THINGS. The record's own copy, the
   *    odometer_readings row the visit wrote, and the vehicle's cached figure.
   *    All three are corrected in one batch, and the cache is REBUILT rather
   *    than nudged, because a correction can move the odometer DOWN and the
   *    normal write path deliberately only moves it up.
   *
   * 2. THE DUE DATES MOVE WITH IT, and that is the point rather than a side
   *    effect. v_maintenance_due computes from the service odometer
   *    (invariant 6): correcting the baseline must move every due point
   *    derived from it, or it was a stored due date all along.
   *
   * 3. REMOVING A LINE ITEM DOES NOT REVERT THE VEHICLE'S INTERVAL. Invariant
   *    6 says the last service sets the schedule, and there is no stored
   *    previous value to revert to -- an item that set 10,000 km leaves the
   *    part on 10,000 km after it is deleted. That is deliberate, not an
   *    oversight to fix: the interval is edited on the maintenance tab, which
   *    is the one place it lives.
   */
  async update(id: string, input: ServiceUpdate) {
    // Loading the record IS the tenant check -- the garage predicate here
    // proves the caller owns it, so there is no assertOwnedVehicle below.
    const existing = await this.raw
      .prepare(
        `SELECT vehicle_id, odometer_reading_id
           FROM service_records
          WHERE id = ? AND garage_id = ?`,
      )
      .bind(id, this.garageId)
      .first<{ vehicle_id: string; odometer_reading_id: string | null }>();
    if (!existing) throw new NotFoundError("Service record not found");

    const vehicleId = existing.vehicle_id;

    // Spec 5.3, exactly as on create: a part type id from the client is a
    // claim, not a fact, and an edit is no less of a write than an insert.
    for (const item of input.items) {
      await this.assertUsablePartType(item.partTypeId);
    }

    // Excluding this service's OWN reading, or moving its date later would
    // compare the reading against itself and reject every forward re-dating.
    await assertReadingNotBackwards(this.raw, {
      vehicleId,
      garageId: this.garageId,
      recordedOn: input.servicedOn,
      readingKm: input.odometerKm,
      excludeReadingId: existing.odometer_reading_id,
    });

    const statements: D1PreparedStatement[] = [
      this.raw
        .prepare(
          `UPDATE service_records
              SET serviced_on = ?, odometer_km = ?, service_type = ?,
                  workshop_name = ?, labour_cost = ?, notes = ?
            WHERE id = ? AND garage_id = ?`,
        )
        .bind(
          input.servicedOn,
          input.odometerKm,
          // Every column written, NULLs included. On a replacement an omitted
          // field means "cleared"; merging would make clearing the workshop
          // name impossible to express.
          input.serviceType ?? null,
          input.workshopName ?? null,
          input.labourCost ?? null,
          input.notes ?? null,
          id,
          this.garageId,
        ),
      // Replace the set wholesale. Diffing incoming against stored items would
      // need a stable client-side id per line, which the form does not have --
      // and the line items carry no history anything reads, so re-creating
      // them loses nothing.
      this.raw
        .prepare(
          `DELETE FROM service_items
            WHERE service_record_id = ? AND garage_id = ?`,
        )
        .bind(id, this.garageId),
      ...this.itemStatements(id, vehicleId, input.items),
    ];

    if (existing.odometer_reading_id) {
      statements.push(
        odometerUpdateStatement(this.raw, {
          readingId: existing.odometer_reading_id,
          garageId: this.garageId,
          readingKm: input.odometerKm,
          recordedOn: input.servicedOn,
        }),
      );
    } else {
      // A service logged before migration 0014 whose reading the backfill
      // could not match. Adopt a fresh one rather than failing: the orphan
      // stays in the history, which is the pre-existing state, and from here
      // on this record is correctable like any other.
      const readingId = crypto.randomUUID();
      statements.push(
        ...odometerWriteStatements(this.raw, {
          readingId,
          garageId: this.garageId,
          vehicleId,
          readingKm: input.odometerKm,
          recordedOn: input.servicedOn,
          source: "service",
        }),
        this.raw
          .prepare(
            `UPDATE service_records SET odometer_reading_id = ?
              WHERE id = ? AND garage_id = ?`,
          )
          .bind(readingId, id, this.garageId),
      );
    }

    // LAST, so it sees the corrected reading.
    statements.push(recacheOdometerStatement(this.raw, { garageId: this.garageId, vehicleId }));

    await this.raw.batch(statements);

    // Re-read rather than RETURNING: the client wants the record in the shape
    // list() produces, totals and derived warranty dates included.
    const [record] = (await this.list(vehicleId)).filter((r) => r.id === id);
    return record;
  }

  async remove(id: string) {
    // Read the link before the delete, or there is nothing left to follow.
    const existing = await this.raw
      .prepare(
        `SELECT vehicle_id, odometer_reading_id
           FROM service_records
          WHERE id = ? AND garage_id = ?`,
      )
      .bind(id, this.garageId)
      .first<{ vehicle_id: string; odometer_reading_id: string | null }>();
    if (!existing) throw new NotFoundError("Service record not found");

    // Same reason, one row further out: service_attachments rows cascade with
    // the record (migration 0015), but the R2 OBJECTS they point at do not.
    // Once the rows are gone there is nothing left holding the keys, so they
    // have to be read while the rows still exist.
    const attached = await this.raw
      .prepare(
        `SELECT r2_key FROM service_attachments
          WHERE service_record_id = ? AND garage_id = ?`,
      )
      .bind(id, this.garageId)
      .all<{ r2_key: string }>();

    // Deleting the visit deletes the reading it wrote. Until migration 0014
    // linked the two this was impossible, so a deleted service left its
    // reading behind -- and with it a vehicle whose cached odometer was held
    // up by a service that no longer existed. service_items cascade
    // (migrations/0001), so they need no statement here.
    const statements: D1PreparedStatement[] = [
      this.raw
        .prepare(`DELETE FROM service_records WHERE id = ? AND garage_id = ?`)
        .bind(id, this.garageId),
    ];

    if (existing.odometer_reading_id) {
      statements.push(
        this.raw
          .prepare(`DELETE FROM odometer_readings WHERE id = ? AND garage_id = ?`)
          .bind(existing.odometer_reading_id, this.garageId),
      );
    }

    statements.push(
      recacheOdometerStatement(this.raw, {
        garageId: this.garageId,
        vehicleId: existing.vehicle_id,
      }),
    );

    await this.raw.batch(statements);

    // After the batch commits, never before: a failed delete must not have
    // already destroyed the files. The reverse order leaves orphan objects,
    // which cost bytes; this order can only ever leave them too, and only if
    // R2 itself fails.
    await deleteAttachments(
      this.docs,
      attached.results.map((r) => r.r2_key),
    );
  }

  /**
   * The line items of a visit, plus the interval each one sets.
   *
   * Shared by create() and update() because it carries invariant 6 and a
   * second copy of it is invisible when the two drift apart.
   *
   * A service visit with no line items resets no maintenance clock
   * (invariant 7). That is a legitimate record -- an inspection, a wash --
   * and it is stored as one. The absence of items is the meaning, which is
   * why an empty list produces no statements rather than an error.
   */
  private itemStatements(
    recordId: string,
    vehicleId: string,
    items: ServiceInput["items"],
  ): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [];

    for (const item of items) {
      statements.push(
        this.raw
          .prepare(
            `INSERT INTO service_items
               (id, garage_id, service_record_id, part_type_id, brand, spec,
                note, quantity_milli, unit_cost, warranty_months,
                interval_km_override, interval_months_override)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            this.garageId,
            recordId,
            item.partTypeId,
            item.brand ?? null,
            item.spec ?? null,
            item.note ?? null,
            item.quantityMilli,
            item.unitCost ?? null,
            item.warrantyMonths ?? null,
            item.intervalKmOverride ?? null,
            item.intervalMonthsOverride ?? null,
          ),
      );

      // The interval keyed in at a service BECOMES the vehicle's interval.
      //
      // One number governs a part, and the last service is what sets it --
      // so the figure written on the workshop sticker is the schedule from
      // then on, until the next service writes a different one. An earlier
      // design kept this as a one-cycle override sitting on top of a separate
      // standing setting; two numbers for one part meant the schedule on
      // screen could disagree with the schedule in the editor, and the owner
      // had no way to tell which one was in charge.
      //
      // COALESCE so a km-only entry does not blank out the months, and the
      // other way round. The copy on the line item stays as history: what the
      // schedule was at that service, which is worth keeping even though
      // nothing computes from it.
      const setsInterval =
        item.intervalKmOverride != null || item.intervalMonthsOverride != null;
      if (setsInterval) {
        statements.push(
          this.raw
            .prepare(
              `INSERT INTO maintenance_intervals
                 (id, garage_id, vehicle_id, part_type_id,
                  interval_km, interval_months, is_active)
               VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 1)
               ON CONFLICT(vehicle_id, part_type_id)
               DO UPDATE SET
                 is_active       = 1,
                 interval_km     = COALESCE(excluded.interval_km,
                                            maintenance_intervals.interval_km),
                 interval_months = COALESCE(excluded.interval_months,
                                            maintenance_intervals.interval_months)`,
            )
            .bind(
              this.garageId,
              vehicleId,
              item.partTypeId,
              item.intervalKmOverride ?? null,
              item.intervalMonthsOverride ?? null,
            ),
        );
      }
    }

    return statements;
  }

  /** Brand suggestions come from this garage's own history only. */
  async brandSuggestions(partTypeId: string) {
    const { results } = await this.raw
      .prepare(
        `SELECT brand, COUNT(*) AS uses
           FROM service_items
          WHERE garage_id = ? AND part_type_id = ? AND brand IS NOT NULL
          GROUP BY brand ORDER BY uses DESC LIMIT 10`,
      )
      .bind(this.garageId, partTypeId)
      .all<{ brand: string; uses: number }>();
    return results;
  }

  /** Which clocks a proposed set of part types would reset. Spec 8.4. */
  async itemsForRecord(recordId: string) {
    return this.db
      .select()
      .from(serviceItems)
      .where(this.where(serviceItems, eq(serviceItems.serviceRecordId, recordId)))
      .orderBy(desc(serviceItems.id));
  }
}

interface ServiceJoinRow {
  id: string;
  serviced_on: string;
  odometer_km: number;
  service_type: ServiceType | null;
  workshop_name: string | null;
  labour_cost: number | null;
  /** Derived: labour + the line items. Never stored. See migrations/0006. */
  total_cost: number | null;
  parts_cost: number | null;
  notes: string | null;
  created_at: string;
  item_id: string | null;
  part_type_id: string | null;
  part_name: string | null;
  brand: string | null;
  spec: string | null;
  note: string | null;
  quantity_milli: number | null;
  unit_cost: number | null;
  line_total_cost: number | null;
  warranty_months: number | null;
  warranty_expires_on: string | null;
  interval_km_override: number | null;
  interval_months_override: number | null;
  next_due_km: number | null;
}

/**
 * Reshapes the join into records-with-items. This is a single pass over rows
 * already narrowed to one vehicle, not an aggregation -- the totals and
 * statuses are all computed in SQL (invariant 4).
 */
function groupItems(rows: ServiceJoinRow[]) {
  const byId = new Map<string, ReturnType<typeof shell>>();
  for (const r of rows) {
    let record = byId.get(r.id);
    if (!record) {
      record = shell(r);
      byId.set(r.id, record);
    }
    if (r.item_id) {
      record.items.push({
        id: r.item_id,
        partTypeId: r.part_type_id!,
        partName: r.part_name,
        brand: r.brand,
        spec: r.spec,
        note: r.note,
        quantityMilli: r.quantity_milli!,
        unitCost: r.unit_cost,
        lineTotalCost: r.line_total_cost,
        warrantyMonths: r.warranty_months,
        warrantyExpiresOn: r.warranty_expires_on,
        intervalKmOverride: r.interval_km_override,
        intervalMonthsOverride: r.interval_months_override,
        nextDueKm: r.next_due_km,
      });
    }
  }
  return [...byId.values()];
}

function shell(r: ServiceJoinRow) {
  return {
    id: r.id,
    servicedOn: r.serviced_on,
    odometerKm: r.odometer_km,
    serviceType: r.service_type,
    workshopName: r.workshop_name,
    labourCost: r.labour_cost,
    partsCost: r.parts_cost,
    totalCost: r.total_cost,
    notes: r.notes,
    createdAt: r.created_at,
    items: [] as {
      id: string;
      partTypeId: string;
      partName: string | null;
      brand: string | null;
      spec: string | null;
      note: string | null;
      quantityMilli: number;
      unitCost: number | null;
      lineTotalCost: number | null;
      warrantyMonths: number | null;
      warrantyExpiresOn: string | null;
      intervalKmOverride: number | null;
      intervalMonthsOverride: number | null;
      nextDueKm: number | null;
    }[],
  };
}
