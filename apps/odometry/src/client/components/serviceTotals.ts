import { parseSen, toQuantityMilli } from "@portals/core";
import type { MaintenanceRow, PartType, ServiceItemDraft } from "../api/hooks";
import type { ItemDraft } from "./ServiceItemRow";

/**
 * The arithmetic behind ServiceSheet: what this visit costs, what it schedules
 * next, and whether it may be saved at all.
 *
 * Split out of the sheet because it is the half that can be WRONG rather than
 * merely ugly. Everything here touches one of two invariants -- money is sen
 * (1) and a line item sends an interval, never a due point (6) -- and a sheet
 * is awkward to test while a pure function is not. serviceTotals.test.ts is
 * the point of this file existing separately; the line count was the prompt,
 * not the reason.
 */

/**
 * Resolves the pre-filled "next due at" for a part, as an ABSOLUTE odometer
 * figure. The vehicle's own interval wins over the part-type default: a
 * schedule the owner has already adjusted for this vehicle is a deliberate
 * answer, and the catalogue default is only a guess at one.
 */
export function makeDefaultNextDueKm(
  odo: number | null,
  maintenance: MaintenanceRow[],
  partTypes: PartType[],
): (partTypeId: string) => number | null {
  return (partTypeId: string) => {
    if (odo === null) return null;
    const row = maintenance.find((r) => r.part_type_id === partTypeId);
    const interval = row
      ? row.interval_km
      : (partTypes.find((p) => p.id === partTypeId)?.default_interval_km ?? null);
    return interval === null ? null : odo + interval;
  };
}

export interface ServiceTotals {
  partsSubtotal: number;
  labourSen: number | null;
  grandTotal: number;
  /** The soonest figure this visit sets, or undefined if it sets none. */
  nextService: number | undefined;
  /** True when some line is due at or before the odometer being saved. */
  badItem: boolean;
}

/**
 * Sen throughout, rounded once per line (invariant 1). This mirrors the
 * line_total_cost generated column, so the running total shown while typing
 * matches what the server computes on save, to the sen.
 */
export function deriveTotals(
  items: ItemDraft[],
  labourCost: string,
  odo: number | null,
  defaultNextDueKm: (partTypeId: string) => number | null,
): ServiceTotals {
  const partsSubtotal = items.reduce((sum, i) => {
    const unit = parseSen(i.unitCost);
    const qty = Number(i.quantity) > 0 ? Number(i.quantity) : 1;
    return unit === null ? sum : sum + Math.round(unit * qty);
  }, 0);

  const labourSen = parseSen(labourCost);

  // The single headline the owner asked for, derived from the lines rather
  // than stored beside them: the soonest of whatever this visit set.
  const nextService = items
    .map((i) => (i.nextDueKm !== "" ? Number(i.nextDueKm) : defaultNextDueKm(i.partTypeId)))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)[0];

  const badItem = items.some((i) => {
    const typed = i.nextDueKm === "" ? null : Number(i.nextDueKm);
    return typed !== null && odo !== null && typed <= odo;
  });

  return {
    partsSubtotal,
    labourSen,
    grandTotal: partsSubtotal + (labourSen ?? 0),
    nextService,
    badItem,
  };
}

/** A service may only be saved against a real, non-negative odometer figure. */
export function canSaveService(odo: number | null, badItem: boolean): boolean {
  return odo !== null && Number.isFinite(odo) && odo >= 0 && !badItem;
}

/**
 * Form strings to the API's shape, and the one conversion that carries
 * invariant 6: an absolute figure goes IN, an interval comes OUT.
 *
 * The interval is sent ALWAYS, not only when it differs from the default.
 * Every service sets the schedule for its part, so leaving the field at the
 * pre-filled figure is an answer ("same as before"), not an absence of one.
 * Sending it every time is what keeps one number in charge: the line item and
 * the vehicle's setting cannot drift apart if each service writes both.
 */
export function toItemDrafts(
  items: ItemDraft[],
  odo: number,
  defaultNextDueKm: (partTypeId: string) => number | null,
): ServiceItemDraft[] {
  return items.map((i) => {
    const draft: ServiceItemDraft = {
      partTypeId: i.partTypeId,
      quantityMilli: Number(i.quantity) > 0 ? toQuantityMilli(Number(i.quantity)) : 1000,
    };
    if (i.brand.trim()) draft.brand = i.brand.trim();
    if (i.spec.trim()) draft.spec = i.spec.trim();
    if (i.note.trim()) draft.note = i.note.trim();
    const unit = parseSen(i.unitCost);
    if (unit !== null) draft.unitCost = unit;
    if (i.warrantyMonths !== "") draft.warrantyMonths = Number(i.warrantyMonths);

    const due = i.nextDueKm === "" ? defaultNextDueKm(i.partTypeId) : Number(i.nextDueKm);
    if (due !== null && due > odo) {
      draft.intervalKmOverride = due - odo;
    }
    return draft;
  });
}
