import { GarageScopedRepo } from "./base";
import type { ServiceType } from "@shared/zod";

/**
 * Which parts a service type pre-fills. Spec 8.4.
 *
 * A template is a convenience only. It decides what the log-service form
 * starts with, never what the saved record contains -- every line can be
 * removed before saving, and no maintenance clock moves until a service_item
 * actually exists (invariant 7). Nothing in the status pipeline reads this
 * table.
 *
 * Rows with vehicle_id NULL apply to every vehicle in the garage, mirroring
 * the part_types.garage_id NULL convention. Only those are written today.
 */

export interface ServiceTemplateRow {
  serviceType: ServiceType;
  partTypeId: string;
  partName: string;
  sortOrder: number;
}

export class ServiceTemplateRepo extends GarageScopedRepo {
  async list(): Promise<ServiceTemplateRow[]> {
    const { results } = await this.raw
      .prepare(
        `SELECT st.service_type, st.part_type_id, pt.name AS part_name, st.sort_order
           FROM service_templates st
           JOIN part_types pt ON pt.id = st.part_type_id
          WHERE st.garage_id = ? AND st.vehicle_id IS NULL
          ORDER BY st.service_type, st.sort_order`,
      )
      .bind(this.garageId)
      .all<{
        service_type: ServiceType;
        part_type_id: string;
        part_name: string;
        sort_order: number;
      }>();

    return results.map((r) => ({
      serviceType: r.service_type,
      partTypeId: r.part_type_id,
      partName: r.part_name,
      sortOrder: r.sort_order,
    }));
  }

  /**
   * Replaces the whole list for one service type.
   *
   * Delete-then-insert rather than a diff: the edit the owner is making is
   * "these are the parts in a minor service now", and an empty array is a
   * meaningful answer (stop pre-filling anything). Both statements go in one
   * batch, so a failed insert cannot leave the template empty.
   */
  async put(serviceType: ServiceType, partTypeIds: string[]): Promise<ServiceTemplateRow[]> {
    // Duplicates would collide with uq_tmpl_garage and fail the whole batch.
    // The client can legitimately send them by double-tapping a part.
    const unique = [...new Set(partTypeIds)];
    for (const id of unique) {
      await this.assertUsablePartType(id);
    }

    const statements: D1PreparedStatement[] = [
      this.raw
        .prepare(
          `DELETE FROM service_templates
            WHERE garage_id = ? AND vehicle_id IS NULL AND service_type = ?`,
        )
        .bind(this.garageId, serviceType),
    ];

    unique.forEach((partTypeId, i) => {
      statements.push(
        this.raw
          .prepare(
            `INSERT INTO service_templates
               (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
             VALUES (?, ?, NULL, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), this.garageId, serviceType, partTypeId, i),
      );
    });

    await this.raw.batch(statements);
    return this.list();
  }
}
