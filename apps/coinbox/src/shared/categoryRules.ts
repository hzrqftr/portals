import type { Direction } from "./zod";

/**
 * What the entry form does when you pick a category.
 *
 * This is the thing a Google Form cannot do (spec 1.1): conditional fields,
 * and a direction that follows the category instead of being set by hand on
 * every row.
 *
 * IT LIVES IN CODE, NOT ON THE `categories` TABLE, and that is deliberate.
 * Both CLAUDE.md files say not to put a direction column on `categories`,
 * because the next person writes `WHERE direction = 'in'` to filter the picker
 * and the mixed categories quietly stop being enterable. Keeping the defaults
 * here keeps that warning literally true: there is nothing direction-shaped in
 * the schema to filter by.
 *
 * DEFAULTS, NEVER CONSTRAINTS. Measured against the owner's real 648 rows: a
 * per-category default would have been right 640 times. The other 8 are real
 * entries in categories that genuinely go both ways --
 *
 *   Household     2 in / 69 out        Savings        2 in / 8 out
 *   Family        1 in / 16 out        Miscellaneous 12 in / 3 out
 *
 * -- so any rule that made those unenterable would be wrong about his own
 * history. The form pre-selects; the user always wins.
 */

export interface CategoryRule {
  /** What the direction becomes when this category is picked, if untouched. */
  defaultDirection: Direction;
  /** Whether the vehicle picker is revealed. */
  showVehicle: boolean;
}

/**
 * Only three categories default to money-in, and all three are unambiguous in
 * the source data: Salary and Extra Income are 100% inbound across 25 rows,
 * and Miscellaneous is 12 in / 3 out -- reimbursements and reclaims.
 *
 * `transportation` is the only category that reveals the vehicle picker: 137
 * of the 138 vehicle-attributed rows are in it. The remaining one is a
 * `Motorcycle fuel` row miscategorised as `Food/ Drinks` in the Sheet, which
 * is a data error rather than a reason to widen this.
 */
const RULES: Record<string, CategoryRule> = {
  transportation: { defaultDirection: "out", showVehicle: true },
  salary: { defaultDirection: "in", showVehicle: false },
  extra_income: { defaultDirection: "in", showVehicle: false },
  miscellaneous: { defaultDirection: "in", showVehicle: false },
};

/**
 * Out, and no vehicle field.
 *
 * The fallback matters as much as the table: 607 of 649 rows are outbound, and
 * an unknown category is far likelier to be a new expense than a new source of
 * income. A category added later behaves sensibly without anyone editing this
 * file -- it simply does not get the extras.
 */
const FALLBACK: CategoryRule = { defaultDirection: "out", showVehicle: false };

export function ruleFor(categoryCode: string | null | undefined): CategoryRule {
  if (!categoryCode) return FALLBACK;
  return RULES[categoryCode] ?? FALLBACK;
}

export function showsVehicle(categoryCode: string | null | undefined): boolean {
  return ruleFor(categoryCode).showVehicle;
}

/**
 * The form's state, reduced to the parts the rules act on. Kept as a plain
 * value so the interaction rules below are pure functions rather than
 * behaviour tangled into a component and only reachable by clicking.
 */
export interface FormState {
  categoryCode: string | null;
  direction: Direction;
  vehicleId: string | null;
  /**
   * Latches the moment the user picks a direction themselves. After that, the
   * category stops overriding it. See applyCategoryChange.
   */
  directionTouched: boolean;
}

export function initialFormState(categoryCode: string | null = null): FormState {
  return {
    categoryCode,
    direction: ruleFor(categoryCode).defaultDirection,
    vehicleId: null,
    directionTouched: false,
  };
}

/**
 * RULE 1: the default applies only until the user touches it.
 * RULE 2: hiding the vehicle field clears its value.
 *
 * Rule 1 exists because the obvious implementation -- always overwrite the
 * direction on category change -- silently discards a deliberate choice. Pick
 * Salary, tap `out` on purpose because this one is a repayment, then correct
 * the category to Miscellaneous, and your `out` flips back to `in` with
 * nothing on screen saying so. A form that quietly overwrites your input is
 * worse than one that never helps.
 *
 * Rule 2 exists because a hidden control that keeps its value still submits
 * it. Pick Transportation, choose the Waja, change your mind and pick
 * Household: without this the grocery run is filed against the car, and the
 * field is no longer on screen to contradict it. Hiding must clear.
 */
export function applyCategoryChange(state: FormState, categoryCode: string | null): FormState {
  const rule = ruleFor(categoryCode);

  return {
    categoryCode,
    direction: state.directionTouched ? state.direction : rule.defaultDirection,
    // Rule 2. Note this clears on ANY move to a category without the field,
    // including between two such categories, so no stale id can survive.
    vehicleId: rule.showVehicle ? state.vehicleId : null,
    directionTouched: state.directionTouched,
  };
}

/**
 * The user picking a direction. Latches `directionTouched` even when the value
 * does not change: tapping the already-selected button is still the user
 * saying "this one", and it should stop the category from second-guessing it.
 */
export function applyDirectionChange(state: FormState, direction: Direction): FormState {
  return { ...state, direction, directionTouched: true };
}

/**
 * Whether this entry contradicts its category's usual direction.
 *
 * NEVER used to block anything. Eight real rows do exactly this -- money from
 * the owner's mother for house repairs is Household-in, a KWSP withdrawal is
 * Savings-in, a card service charge is Miscellaneous-out. It exists so the UI
 * can say so quietly, and so the condition has one definition.
 */
export function isUnusualDirection(state: FormState): boolean {
  if (!state.categoryCode) return false;
  return state.direction !== ruleFor(state.categoryCode).defaultDirection;
}

/**
 * Split the category list into the ones that usually go this direction and the
 * rest. REORDERING, NOT FILTERING, and the distinction is the whole point.
 *
 * Both CLAUDE.md files say "do not filter the category picker by the selected
 * direction", and the owner's own data says why: hiding the outbound-leaning
 * categories while Money In is selected would make five real entries
 * unenterable, including RM 3,000 from his mother for the roof. The person
 * would have to pick a wrong category, save, and edit it afterwards -- which
 * is worse than a longer list.
 *
 * Ordering gets the ergonomic half for free. Picking Money In floats Salary,
 * Extra Income and Miscellaneous to the top, which is the mis-tap this guards
 * against, while everything stays reachable underneath.
 */
export function partitionByDirection<T extends { code: string }>(
  all: readonly T[],
  direction: Direction,
): { usual: T[]; other: T[] } {
  const usual: T[] = [];
  const other: T[] = [];

  for (const c of all) {
    if (ruleFor(c.code).defaultDirection === direction) usual.push(c);
    else other.push(c);
  }

  return { usual, other };
}
