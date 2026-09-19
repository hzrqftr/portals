import { formatSen } from "@portals/core";

export { formatSen };

/**
 * Relative time is the primary label, absolute the secondary (spec 9).
 * "Overdue by 12 days" is a thing you act on; "2026-08-08" is a thing you
 * have to do arithmetic on while standing at a pump.
 */
export function relativeDays(days: number | null): string {
  if (days === null) return "no date yet";
  if (days < 0) {
    const n = Math.abs(days);
    if (n === 1) return "overdue by 1 day";
    if (n < 14) return `overdue by ${n} days`;
    if (n < 60) return `overdue by about ${Math.round(n / 7)} weeks`;
    return `overdue by about ${Math.round(n / 30)} months`;
  }
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days < 14) return `due in ${days} days`;
  if (days < 60) return `due in about ${Math.round(days / 7)} weeks`;
  return `due in about ${Math.round(days / 30)} months`;
}

export function formatKm(km: number | null): string {
  if (km === null) return "\u2014";
  return `${km.toLocaleString("en-MY")} km`;
}

/**
 * "10,000 km or 6 months" -- an interval as the manuals write it, whichever
 * comes first. Either half may be missing; both missing reads "not set".
 */
export function formatInterval(km: number | null, months: number | null): string {
  const parts = [
    km !== null ? formatKm(km) : null,
    months !== null ? `${months} month${months === 1 ? "" : "s"}` : null,
  ];
  return parts.filter(Boolean).join(" or ") || "not set";
}
