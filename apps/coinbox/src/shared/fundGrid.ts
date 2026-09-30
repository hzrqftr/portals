/**
 * What one cell of the Family fund grid says. docs/coinbox-spec.md §11.
 *
 * Pure, and tested in tests/fund-grid-logic.test.ts, because the grid is the
 * whole of what the owner reads -- and it replaces a hand-ticked grid that had
 * already drifted from the ledger it summarised. Each state below is derived
 * from contributions, never stored.
 *
 * There is deliberately NO "owed" or "behind" state. Contributions are not a
 * fixed amount (a member may skip by agreement, the agreed figure may change),
 * so the grid says what happened, month by month, and draws no conclusion.
 */

export type CellState =
  /** Money arrived for this month. */
  | "paid"
  /** An agreed skip: a RM 0.00 contribution. Accounted for, not missing. */
  | "skipped"
  /** Nothing yet, but the member's recurring entry will post it this month. */
  | "auto"
  /** Nothing recorded for a month that has started. */
  | "open"
  /** A month that has not started. Still enterable -- people pay ahead. */
  | "future"
  /** Before the fund's first contribution. Not a gap; there was no fund. */
  | "before";

export interface CellInput {
  /** 'YYYY-MM' of this cell. */
  month: string;
  /** 'YYYY-MM' of the owner's today. */
  currentMonth: string;
  /** The fund's first contribution month, or null for an empty fund. */
  firstMonth: string | null;
  /** Sum and count of contributions for this member and month, if any. */
  cell: { paidSen: number; entries: number } | null;
  /** The member's linked recurring entry, when it still exists and runs. */
  rule: { isActive: boolean } | null;
}

export function cellState({ month, currentMonth, firstMonth, cell, rule }: CellInput): CellState {
  // A recorded row always wins, including in the future: paying ahead is real.
  if (cell && cell.entries > 0) return cell.paidSen > 0 ? "paid" : "skipped";
  if (month > currentMonth) return "future";
  // Only THIS month: a linked rule that did not post in a past month did not
  // post, and pretending otherwise would hide exactly the failure that matters.
  if (month === currentMonth && rule?.isActive) return "auto";
  if (firstMonth !== null && month < firstMonth) return "before";
  return "open";
}

/** The twelve 'YYYY-MM' keys of a year. */
export function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * How a bank check reads. The owner's concern is one-sided: the bank holding
 * LESS than recorded. More is normal -- the account earns a dividend the pot
 * does not track -- so it is shown, but not as a warning.
 */
export function checkTone(gapSen: number): "short" | "ahead" | "exact" {
  if (gapSen < 0) return "short";
  return gapSen > 0 ? "ahead" : "exact";
}

/**
 * What the contribution sheet offers for one member and month, given what is
 * already recorded there. A month holds ONE state -- paid or skipped -- so:
 *
 *  - SKIP replaces hand-entered payments (and says how much it removes), and
 *    is not offered at all on a month that is already skipped.
 *  - PAYING a skipped month replaces the skip; paying a paid month ADDS, since
 *    a top-up is a real second payment.
 *  - A month holding a contribution posted from the ledger cannot be skipped
 *    here: that payment is a ledger row, and is removed in the Ledger.
 */
export interface MonthActions {
  /** Every row is a RM 0.00 skip. */
  isSkipped: boolean;
  /** Hand-entered money that a skip would remove. */
  removesSen: number;
  /** A ledger-posted contribution is present; skipping is refused. */
  hasLinked: boolean;
  canSkip: boolean;
  /** Whether a payment replaces what is there (a skip) or adds to it. */
  paymentReplaces: boolean;
}

export function monthActions(
  existing: readonly { amountSen: number; transactionId: string | null }[],
): MonthActions {
  const isSkipped = existing.length > 0 && existing.every((c) => c.amountSen === 0);
  const hasLinked = existing.some((c) => c.transactionId !== null);
  const removesSen = existing
    .filter((c) => c.transactionId === null)
    .reduce((a, c) => a + c.amountSen, 0);
  return {
    isSkipped,
    removesSen,
    hasLinked,
    canSkip: !isSkipped && !hasLinked,
    paymentReplaces: isSkipped,
  };
}
