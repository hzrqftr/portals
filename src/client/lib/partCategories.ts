/**
 * How part categories are presented: what order they appear in, and what they
 * are called.
 *
 * One module because three places need the same answer -- the maintenance
 * grid, the "not tracked" list and the part picker in the service form -- and
 * three copies of an ordered list is three chances for them to disagree about
 * where Suspension goes.
 *
 * The server sorts `ORDER BY category, name` (data/partTypes.ts), which is
 * alphabetical: battery, belt, brake, cooling, drivetrain... That is fine as a
 * stable sort key and meaningless as a reading order, so the display order is
 * declared here instead.
 */

/**
 * Reading order, roughly what a workshop works through: the consumables that
 * get changed every service first, the wear items you inspect underneath
 * further down, and the odds and ends last.
 *
 * Anything whose category is missing from this list still renders -- see
 * `orderedCategories` -- so adding a category to the database without
 * touching this file degrades to "shows up at the end", not "disappears".
 */
export const CATEGORY_ORDER = [
  "fluid",
  "filter",
  "engine",
  "cooling",
  "electrical",
  "belt",
  "brake",
  "suspension",
  "drivetrain",
  "tyre",
  "battery",
  "other",
] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  fluid: "Fluids",
  filter: "Filters",
  engine: "Engine",
  cooling: "Cooling",
  electrical: "Electrical",
  belt: "Belts & chains",
  brake: "Brakes",
  suspension: "Suspension & steering",
  drivetrain: "Drivetrain",
  tyre: "Tyres & wheels",
  battery: "Battery",
  other: "Other",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? "Other";
}

/**
 * Groups rows by category and returns them in reading order, skipping
 * categories nothing landed in.
 *
 * Order WITHIN each group is left exactly as it arrived. The server has
 * already sorted overdue -> due_soon -> ok -> unknown, and re-sorting here
 * would quietly undo that -- the reason a part needs attention is the only
 * thing that should decide what sits at the top of its group.
 *
 * A category the server knows about but this file does not gets appended
 * after the known ones rather than dropped.
 */
export function groupByCategory<T>(
  rows: T[],
  categoryOf: (row: T) => string,
): { category: string; rows: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = categoryOf(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const known = CATEGORY_ORDER.filter((c) => buckets.has(c)) as readonly string[];
  const unknown = [...buckets.keys()]
    .filter((c) => !(CATEGORY_ORDER as readonly string[]).includes(c))
    .sort();

  return [...known, ...unknown].map((category) => ({
    category,
    rows: buckets.get(category)!,
  }));
}
