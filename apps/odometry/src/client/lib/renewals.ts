import type { RenewalType } from "../api/hooks";

export const RENEWAL_LABELS: Record<RenewalType, string> = {
  road_tax: "Road tax",
  insurance: "Insurance",
  inspection: "Inspection",
  warranty: "Warranty",
};

/**
 * Always shown, recorded or not. Spec 6.3: a type that was never entered is a
 * setup prompt, not an alert -- so these two get a card asking to be filled
 * in, and the other two appear only once someone adds one.
 */
export const CORE_RENEWALS: readonly RenewalType[] = ["road_tax", "insurance"];

export const OTHER_RENEWALS: readonly RenewalType[] = ["inspection", "warranty"];

/**
 * "Expires in about 5 weeks", not relativeDays()'s "due in".
 *
 * The boundary differs from maintenance on purpose, matching the server: a
 * road tax that expires on the 20th is still valid ON the 20th, so 0 days is
 * "expires today", not "expired".
 */
export function relativeExpiry(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    if (n === 1) return "expired yesterday";
    if (n < 14) return `expired ${n} days ago`;
    if (n < 60) return `expired about ${Math.round(n / 7)} weeks ago`;
    return `expired about ${Math.round(n / 30)} months ago`;
  }
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  if (days < 14) return `expires in ${days} days`;
  if (days < 60) return `expires in about ${Math.round(days / 7)} weeks`;
  return `expires in about ${Math.round(days / 30)} months`;
}
