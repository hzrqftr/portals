import { eq, desc } from "drizzle-orm";
import { ScopedRepo } from "./base";
import { serviceRecords, serviceItems } from "../schema";
import { NotFoundError } from "../errors";
import { nowIso } from "@shared/dates";
import type { ServiceInput, ServicePatch, ServiceType } from "@shared/zod";

export class ServiceRepo extends ScopedRepo {
  async list(vehicleId: string) {
    await this.assertOwnedVehicle(vehicleId);

    // One query with a join, not one query per record to fetch its items.
    const { results } = await this.raw
      .prepare(
        `SELECT sr.id, sr.serviced_on, sr.odometer_km, sr.service_type,
                sr.workshop_name, sr.total_cost, sr.notes, sr.created_at,
                si.id AS item_id, si.part_type_id, pt.name AS part_name,
                si.brand, si.spec, si.quantity_milli, si.unit_cost,
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
              workshop_name, total_cost, notes, created_at)
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
          input.totalCost ?? null,
          input.notes ?? null,
          ts,
        ),
    ];

    // A service visit with no line items resets no maintenance clock
    // (invariant 7). That is a legitimate record -- an inspection, a wash --
    // and it is stored as one. The absence of items is the meaning.
    for (const item of input.items) {
      statements.push(
        this.raw
          .prepare(
            `INSERT INTO service_items
               (id, garage_id, service_record_id, part_type_id, brand, spec,
                quantity_milli, unit_cost, warranty_months,
                interval_km_override, interval_months_override)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            this.garageId,
            recordId,
            item.partTypeId,
            item.brand ?? null,
            item.spec ?? null,
            item.quantityMilli,
            item.unitCost ?? null,
            item.warrantyMonths ?? null,
            item.intervalKmOverride ?? null,
            item.intervalMonthsOverride ?? null,
          ),
      );

      // An override needs somewhere to land.
      //
      // v_maintenance_due starts FROM maintenance_intervals, so a part with
      // no active interval row is absent from the view entirely -- and the
      // "next due" the owner just typed would have no visible effect at all.
      // Silently doing nothing is the worst option here, so: create the
      // interval if it is missing, reactivate it if it was switched off.
      //
      // DO UPDATE deliberately does not overwrite an existing configured
      // interval. The override already wins for this cycle through the view;
      // clobbering the vehicle's own setting would make a one-off permanent,
      // which is the opposite of what "just this once" means.
      const hasOverride =
        item.intervalKmOverride != null || item.intervalMonthsOverride != null;
      if (hasOverride) {
        statements.push(
          this.raw
            .prepare(
              `INSERT INTO maintenance_intervals
                 (id, garage_id, vehicle_id, part_type_id,
                  interval_km, interval_months, is_active)
               VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 1)
               ON CONFLICT(vehicle_id, part_type_id)
               DO UPDATE SET is_active = 1`,
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

    statements.push(
      this.raw
        .prepare(
          `INSERT INTO odometer_readings
             (id, garage_id, vehicle_id, reading_km, recorded_on, source)
           VALUES (?,?,?,?,?,'service')`,
        )
        .bind(crypto.randomUUID(), this.garageId, vehicleId, input.odometerKm, input.servicedOn),
      this.raw
        .prepare(
          `UPDATE vehicles
              SET current_odometer_km = ?, odometer_updated_on = ?, updated_at = ?
            WHERE id = ? AND garage_id = ?
              AND (odometer_updated_on IS NULL OR odometer_updated_on <= ?)`,
        )
        .bind(input.odometerKm, input.servicedOn, ts, vehicleId, this.garageId, input.servicedOn),
    );

    await this.raw.batch(statements);
    return recordId;
  }

  async update(id: string, patch: ServicePatch) {
    const [row] = await this.db
      .update(serviceRecords)
      .set(patch)
      .where(this.where(serviceRecords, eq(serviceRecords.id, id)))
      .returning();
    if (!row) throw new NotFoundError("Service record not found");
    return row;
  }

  async remove(id: string) {
    const [row] = await this.db
      .delete(serviceRecords)
      .where(this.where(serviceRecords, eq(serviceRecords.id, id)))
      .returning({ id: serviceRecords.id });
    if (!row) throw new NotFoundError("Service record not found");
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
  total_cost: number | null;
  notes: string | null;
  created_at: string;
  item_id: string | null;
  part_type_id: string | null;
  part_name: string | null;
  brand: string | null;
  spec: string | null;
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
    totalCost: r.total_cost,
    notes: r.notes,
    createdAt: r.created_at,
    items: [] as {
      id: string;
      partTypeId: string;
      partName: string | null;
      brand: string | null;
      spec: string | null;
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
