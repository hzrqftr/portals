import { describe, it, expect } from "vitest";
import { cellState, checkTone, monthActions, monthsOf, type CellInput } from "@shared/fundGrid";

/**
 * The grid's reading of each cell. See src/shared/fundGrid.ts.
 *
 * Each case is a way the hand-ticked workbook grid could be wrong, and the
 * derived one must not be.
 */

const base: CellInput = {
  month: "2026-10",
  currentMonth: "2026-10",
  firstMonth: "2024-01",
  cell: null,
  rule: null,
};

describe("cellState", () => {
  it("reads a paid month as paid, whatever the amount", () => {
    expect(cellState({ ...base, cell: { paidSen: 20_000, entries: 1 } })).toBe("paid");
    expect(cellState({ ...base, cell: { paidSen: 15_000, entries: 1 } })).toBe("paid");
  });

  it("tells an agreed RM 0.00 skip apart from a month with nothing", () => {
    expect(cellState({ ...base, cell: { paidSen: 0, entries: 1 } })).toBe("skipped");
    expect(cellState({ ...base, cell: null })).toBe("open");
  });

  it("shows a recurring entry as automatic only for the current month", () => {
    const rule = { isActive: true };
    expect(cellState({ ...base, rule })).toBe("auto");
    // A past month the rule did not post is OPEN: the failure must show.
    expect(cellState({ ...base, month: "2026-09", rule })).toBe("open");
  });

  it("does not promise a paused rule will post", () => {
    expect(cellState({ ...base, rule: { isActive: false } })).toBe("open");
  });

  it("lets a paid-ahead month read as paid", () => {
    expect(cellState({ ...base, month: "2026-12", cell: { paidSen: 20_000, entries: 1 } })).toBe(
      "paid",
    );
    expect(cellState({ ...base, month: "2026-12" })).toBe("future");
  });

  it("does not call the months before the fund existed gaps", () => {
    expect(cellState({ ...base, month: "2023-12" })).toBe("before");
    expect(cellState({ ...base, month: "2023-12", firstMonth: null })).toBe("open");
  });
});

describe("monthsOf", () => {
  it("gives twelve zero-padded months", () => {
    expect(monthsOf(2026)).toHaveLength(12);
    expect(monthsOf(2026)[0]).toBe("2026-01");
    expect(monthsOf(2026)[11]).toBe("2026-12");
  });
});

describe("checkTone", () => {
  it("warns only when the bank holds less than recorded", () => {
    expect(checkTone(-17_335)).toBe("short");
    expect(checkTone(2_665)).toBe("ahead");
    expect(checkTone(0)).toBe("exact");
  });
});

describe("monthActions", () => {
  const paid = { amountSen: 20_000, transactionId: null };
  const skip = { amountSen: 0, transactionId: null };
  const linked = { amountSen: 20_000, transactionId: "txn" };

  it("offers a plain skip on an empty month, and a payment that adds", () => {
    expect(monthActions([])).toMatchObject({ canSkip: true, removesSen: 0, paymentReplaces: false });
  });

  it("says how much a skip over a payment removes", () => {
    expect(monthActions([paid])).toMatchObject({ canSkip: true, removesSen: 20_000 });
  });

  it("does not offer skipping a month twice", () => {
    expect(monthActions([skip])).toMatchObject({ isSkipped: true, canSkip: false });
  });

  it("lets a payment replace a skip, but a top-up add to a payment", () => {
    expect(monthActions([skip]).paymentReplaces).toBe(true);
    expect(monthActions([paid]).paymentReplaces).toBe(false);
  });

  it("refuses to skip over a contribution posted from the ledger", () => {
    expect(monthActions([linked])).toMatchObject({ hasLinked: true, canSkip: false });
  });
});
