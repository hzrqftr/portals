import { parseSen, toQuantityMilli } from "@portals/core";
import type { MaintenanceRow, ServiceItemDraft } from "../api/hooks";
import type { ItemDraft } from "./ServiceItemRow";

/**
 * The arithmetic behind ServiceSheet: what this visit costs, which clocks it
 * resets, and whether it changes the schedule.
 *
 * Split out of the sheet because it is the half that can be WRONG rather than
 * merely ugly. Everything here touches one of two invariants -- money is sen
 * (1) and a line item sends an interval, never a due point (6) -- and a sheet
 * is awkward to test while a pure function is not. serviceTotals.test.ts is
 * the point of this file existing separately.
 *
 * Since 2026-09-20 a service changes the schedule ONLY when the owner asks it
 * to, on the line concerned ("Change schedule" / "Add to schedule"). Before,
 * every line sent an interval -- pre-filled from the current one -- so every
 * service rewrote the schedule whether or not anyone meant it to.
 */

/** A line's explicit schedule change, or null when it leaves the schedule alone. */
export function adoptedInterval(item: ItemDraft): { km: number | null; months: number | null } | null {
  if (!item.adopting) return null;
  const km = item.adoptKm === "" ? null : Number(item.adoptKm);
  const months = item.adoptMonths === "" ? null : Number(item.adoptMonths);
  if (km === null && months === null) return null;
  return { km, months };
}

/** A zero typed into either figure: no interval is zero long, and the API refuses one. */
function hasZeroFigure(item: ItemDraft): boolean {
  return item.adopting && (item.adoptKm === "0" || item.adoptMonths === "0");
}

export interface ServiceTotals {
  partsSubtotal: number;
  labourSen: number | null;
  grandTotal: number;
  /** The soonest km figure a part on this visit falls due at next, or undefined. */
  nextService: number | undefined;
  /** True when a line's schedule change cannot be saved as typed. */
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
  maintenance: MaintenanceRow[],
): ServiceTotals {
  const partsSubtotal = items.reduce((sum, i) => {
    const unit = parseSen(i.unitCost);
    const qty = Number(i.quantity) > 0 ? Number(i.quantity) : 1;
    return unit === null ? sum : sum + Math.round(unit * qty);
  }, 0);

  const labourSen = parseSen(labourCost);

  // The headline the owner asked for, derived rather than stored: the soonest
  // any part on this visit falls due again, on the schedule it will have
  // after the save -- the adopted figure where there is one.
  const nextService =
    odo === null
      ? undefined
      : items
          .map((i) => {
            const adopted = adoptedInterval(i);
            if (adopted) return adopted.km === null ? null : odo + adopted.km;
            const km = intervalKmOf(maintenance, i.partTypeId);
            return km === null ? null : odo + km;
          })
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b)[0];

  return {
    partsSubtotal,
    labourSen,
    grandTotal: partsSubtotal + (labourSen ?? 0),
    nextService,
    badItem: items.some(hasZeroFigure),
  };
}

function intervalKmOf(maintenance: MaintenanceRow[], partTypeId: string): number | null {
  return maintenance.find((r) => r.part_type_id === partTypeId)?.interval_km ?? null;
}

/** A service may only be saved against a real, non-negative odometer figure. */
export function canSaveService(odo: number | null, badItem: boolean): boolean {
  return odo !== null && Number.isFinite(odo) && odo >= 0 && !badItem;
}

/**
 * Which parts on this visit reset a maintenance clock, by name.
 *
 * A clock resets for every part that is on the schedule (invariant 7: the
 * line item IS the reset) and for any part this visit puts on it. A part on
 * no schedule -- a throttle position sensor, replaced when it fails -- resets
 * nothing, and the save confirmation must not claim it did. That exact false
 * claim reached production once (2026-09-19), which is why this is computed
 * rather than assumed to be "every part on the visit".
 */
export function partsResettingAClock(items: ItemDraft[], maintenance: MaintenanceRow[]): string[] {
  return items
    .filter(
      (i) =>
        adoptedInterval(i) !== null || maintenance.some((r) => r.part_type_id === i.partTypeId),
    )
    .map((i) => i.partName);
}

/** Which parts this visit changes the schedule of, by name. */
export function partsChangingTheSchedule(items: ItemDraft[]): string[] {
  return items.filter((i) => adoptedInterval(i) !== null).map((i) => i.partName);
}

/**
 * Form strings to the API's shape.
 *
 * The interval fields are sent ONLY for a line the owner explicitly adopted a
 * figure on. Their absence is the normal case and means "leave the schedule
 * alone" -- the server writes the schedule from them and from nothing else.
 */
export function toItemDrafts(items: ItemDraft[]): ServiceItemDraft[] {
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

    const adopted = adoptedInterval(i);
    if (adopted?.km != null) draft.intervalKmOverride = adopted.km;
    if (adopted?.months != null) draft.intervalMonthsOverride = adopted.months;
    return draft;
  });
}
