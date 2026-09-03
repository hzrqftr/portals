/**
 * What the entry form does when you tell it an entry is a fill-up.
 *
 * Same split as @shared/categoryRules, and for the same reason: these rules are
 * the part that is wrong in a way nobody notices, and behaviour reachable only
 * by clicking is behaviour that gets verified once and then drifts. The
 * component holds state and paints; this file decides.
 *
 * WHY A TOGGLE RATHER THAN A CATEGORY. There is no `fuel` category and adding
 * one would split five years of history -- every fuel row the owner has is
 * Transportation, and an analytics query that had to handle both would be
 * wrong the first time someone forgot. The toggle says the same thing without
 * touching a single existing row.
 */

/** Litres, as typed. Kept as a string for the same reason `amount` is. */
export interface FuelState {
  /** Whether this entry is a fill-up at all. */
  isFill: boolean;
  odometerKm: string;
  litres: string;
  isFullTank: boolean;
}

export function initialFuelState(): FuelState {
  return {
    isFill: false,
    odometerKm: "",
    litres: "",
    // Most fills are full, and the wrong default here is not a typo -- it
    // silently produces a consumption figure in a plausible range. Defaulting
    // to full matches reality and makes the exception the deliberate tap.
    isFullTank: true,
  };
}

/**
 * Turning the toggle off CLEARS the values, exactly like the vehicle picker's
 * Rule 2 in categoryRules.ts.
 *
 * A hidden control that keeps its value still submits it. Tick fill-up, key in
 * an odometer, change your mind and untick: without this the reading is still
 * written to Odometry and the field is no longer on screen to contradict it.
 */
export function applyFillToggle(state: FuelState, isFill: boolean): FuelState {
  if (!isFill) return initialFuelState();
  return { ...state, isFill: true };
}

/**
 * Losing the vehicle loses the fill. An odometer belongs to a vehicle, so a
 * fill with no vehicle has nowhere to go -- the API rejects it, and the form
 * should never have been able to build it.
 */
export function applyVehicleChange(state: FuelState, vehicleId: string | null): FuelState {
  return vehicleId ? state : initialFuelState();
}

/** Litres as an integer count of thousandths, or null if unparseable. */
export function parseLitresMilli(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000);
}

export function parseOdometerKm(input: string): number | null {
  const cleaned = input.replace(/[^0-9]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A fill is only submittable once both physical numbers are present. */
export function isFuelComplete(state: FuelState): boolean {
  if (!state.isFill) return true;
  return parseOdometerKm(state.odometerKm) !== null && parseLitresMilli(state.litres) !== null;
}

/**
 * Price per litre, derived. Never stored, and never typed.
 *
 * Litres is the physically meaningful number and the one consumption needs;
 * deriving it back out of a rounded price per litre would carry that rounding
 * into every figure. So litres is what gets keyed in, and this is shown beside
 * it as the check -- if it does not match the pump, something was mistyped.
 */
export function senPerLitre(amountSen: number | null, litresMilli: number | null): number | null {
  if (amountSen === null || litresMilli === null || litresMilli <= 0) return null;
  return Math.round((amountSen * 1000) / litresMilli);
}

/**
 * A PLAUSIBILITY BAND, NOT A VALIDATION RULE.
 *
 * The API rejects a reading lower than an earlier one, which catches "12000"
 * typed as "1200". It cannot catch "112000" typed for "12000": that is higher
 * than everything before it and therefore indistinguishable from a real
 * reading. Readings have no correction path, so that mistake is permanent.
 *
 * This is the only thing standing between a fat finger and a silently poisoned
 * consumption series, and it deliberately BLOCKS NOTHING -- the same posture as
 * isUnusualDirection. Real numbers do fall outside these bounds (a long trip
 * between fills, a jerry can), and a form that refuses a true fact is worse
 * than one that mentions an odd-looking one.
 *
 * The bounds are wide on purpose: a small car is around 6 L/100km and a laden
 * pickup around 15, so 2 and 30 flag only the order-of-magnitude slips.
 */
export function fuelWarning(
  litresMilli: number | null,
  odometerKm: number | null,
  previousOdometerKm: number | null,
): string | null {
  if (litresMilli === null || odometerKm === null) return null;

  if (previousOdometerKm === null) return null;

  const distance = odometerKm - previousOdometerKm;
  if (distance <= 0) {
    return `That is not ahead of the last reading of ${previousOdometerKm.toLocaleString()} km.`;
  }

  const lPer100 = (litresMilli / 1000) * (100 / distance);
  if (lPer100 < 2) {
    return `That works out at ${lPer100.toFixed(1)} L/100km over ${distance.toLocaleString()} km, which looks too good. Check the odometer.`;
  }
  if (lPer100 > 30) {
    return `That works out at ${lPer100.toFixed(1)} L/100km over ${distance.toLocaleString()} km, which looks high. Check the odometer.`;
  }
  return null;
}
