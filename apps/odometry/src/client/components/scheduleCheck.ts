import type { MaintenanceRow } from "../api/hooks";

/**
 * Was this part replaced early, late, or on schedule? (2026-09-20)
 *
 * Logging a service no longer changes the schedule by itself. Instead the
 * form compares the replacement against it and SAYS so -- "early by 4,000 km,
 * schedule is 10,000 km" -- and the owner decides whether the schedule should
 * change. This is that comparison, as a pure function so it can be tested.
 *
 * "Whichever comes first", as every manual on the owner's Desktop puts it: a
 * part is due when EITHER clock runs out. So it is LATE if either clock ran
 * past the interval, and EARLY only if neither clock had reached it.
 *
 * The tolerance is so that oil changed at 9,800 km on a 10,000 km schedule
 * reads as on schedule rather than "early by 200 km", which would train the
 * owner to ignore the notice. It is a judgement, kept in one place.
 *
 * Measured from the part's baseline -- its most recent replacement -- which
 * is only meaningful for a NEW service. An edit of an old one would measure
 * the service against itself, so the form does not ask.
 */

export const KM_TOLERANCE = 0.1; // a tenth of the interval
export const MONTHS_TOLERANCE = 1;

export type ScheduleCheck =
  /** Not on this vehicle's schedule at all. */
  | { kind: "untracked" }
  /** Tracked, but nothing to measure from: first replacement logged, or backdated. */
  | { kind: "no-baseline" }
  | { kind: "on-schedule"; drivenKm: number | null; elapsedMonths: number | null }
  | {
      kind: "early" | "late";
      /** How far off, per clock. Null for a clock that did not decide it. */
      byKm: number | null;
      byMonths: number | null;
      intervalKm: number | null;
      intervalMonths: number | null;
      drivenKm: number | null;
      elapsedMonths: number | null;
    };

/** Whole calendar months from `from` to `to`, both YYYY-MM-DD. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

export function checkAgainstSchedule(
  row: MaintenanceRow | undefined,
  odometerKm: number | null,
  servicedOn: string,
): ScheduleCheck {
  if (!row) return { kind: "untracked" };

  const drivenKm =
    row.baseline_km !== null && odometerKm !== null ? odometerKm - row.baseline_km : null;
  const elapsedMonths =
    row.baseline_date !== null && /^\d{4}-\d{2}-\d{2}$/.test(servicedOn)
      ? monthsBetween(row.baseline_date, servicedOn)
      : null;

  // Nothing to measure from, or a visit dated before the last one: in both
  // cases any "early by" figure would be nonsense, so say nothing.
  if (drivenKm === null && elapsedMonths === null) return { kind: "no-baseline" };
  if ((drivenKm !== null && drivenKm <= 0) || (elapsedMonths !== null && elapsedMonths < 0)) {
    return { kind: "no-baseline" };
  }

  const { interval_km: iKm, interval_months: iMonths } = row;
  const kmSlack = iKm === null ? 0 : Math.round(iKm * KM_TOLERANCE);

  const kmLate = iKm !== null && drivenKm !== null && drivenKm > iKm + kmSlack;
  const monthsLate =
    iMonths !== null && elapsedMonths !== null && elapsedMonths > iMonths + MONTHS_TOLERANCE;
  const common = { intervalKm: iKm, intervalMonths: iMonths, drivenKm, elapsedMonths };

  if (kmLate || monthsLate) {
    return {
      kind: "late",
      byKm: kmLate ? drivenKm! - iKm! : null,
      byMonths: monthsLate ? elapsedMonths! - iMonths! : null,
      ...common,
    };
  }

  // A clock counts as reached when it is within tolerance of its interval. A
  // clock we cannot read (no interval, or no baseline figure) never counts as
  // reached -- but it cannot make the part early on its own either.
  const kmReached = iKm !== null && drivenKm !== null && drivenKm >= iKm - kmSlack;
  const monthsReached =
    iMonths !== null && elapsedMonths !== null && elapsedMonths >= iMonths - MONTHS_TOLERANCE;
  const kmReadable = iKm !== null && drivenKm !== null;
  const monthsReadable = iMonths !== null && elapsedMonths !== null;

  if (!kmReached && !monthsReached && (kmReadable || monthsReadable)) {
    return {
      kind: "early",
      byKm: kmReadable ? iKm! - drivenKm! : null,
      byMonths: monthsReadable ? iMonths! - elapsedMonths! : null,
      ...common,
    };
  }

  return { kind: "on-schedule", drivenKm, elapsedMonths };
}

/**
 * What "Change schedule" pre-fills: the interval this replacement actually
 * ran to -- on the clock that decided it, and ONLY that one. The other half
 * is left blank, which keeps it as it is.
 *
 * Changing both is wrong in the ordinary case. Oil changed at 6,000 km two
 * months in, on a 10,000 km / 6 month schedule, is an owner shortening the
 * distance; offering "6,000 km or 2 months" would quietly turn it into a
 * two-month time clock nobody asked for. Late: the clock that ran over.
 * Early: km, which is what an early change is nearly always about, or months
 * when the schedule has no km clock.
 *
 * Km rounded to 500 because that is how a workshop sticker reads. Editable
 * before saving, so this is a starting point, not a decision.
 */
export function suggestedInterval(check: ScheduleCheck): { km: number | null; months: number | null } {
  if (check.kind !== "early" && check.kind !== "late") return { km: null, months: null };
  const kmFigure =
    check.drivenKm !== null ? Math.max(500, Math.round(check.drivenKm / 500) * 500) : null;
  const monthsFigure = check.elapsedMonths !== null ? Math.max(1, check.elapsedMonths) : null;

  if (check.kind === "late") {
    return {
      km: check.byKm !== null ? kmFigure : null,
      months: check.byMonths !== null ? monthsFigure : null,
    };
  }
  return check.byKm !== null ? { km: kmFigure, months: null } : { km: null, months: monthsFigure };
}
