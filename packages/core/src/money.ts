/**
 * Money is always an integer count of minor units (sen). CLAUDE.md invariant 1.
 *
 * RM 245.50 is the number 24550. There is no float anywhere in the money
 * path: SQLite has no decimal type, and a float total is wrong in a way that
 * looks right until the sums stop matching the receipts.
 *
 * Convert at the UI boundary only, using these two functions.
 */

export type Sen = number;

export function toSen(major: number): Sen {
  return Math.round(major * 100);
}

/** Parses user input like "245.50", "RM 245.50", "1,245.5" into sen. */
export function parseSen(input: string): Sen | null {
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatSen(sen: Sen | null | undefined, currency = "MYR"): string {
  if (sen === null || sen === undefined) return "\u2014";
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(sen / 100);
}

/**
 * Quantities are stored as integer thousandths for the same reason money is
 * stored as integer sen: 0.5 litres times a sen price must not become a float.
 */
export const QUANTITY_SCALE = 1000;

export function toQuantityMilli(quantity: number): number {
  return Math.round(quantity * QUANTITY_SCALE);
}

export function fromQuantityMilli(milli: number): number {
  return milli / QUANTITY_SCALE;
}
