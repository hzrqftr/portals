import { describe, it, expect } from "vitest";
import {
  adoptedInterval,
  canSaveService,
  deriveTotals,
  partsChangingTheSchedule,
  partsResettingAClock,
  toItemDrafts,
} from "../src/client/components/serviceTotals";
import type { ItemDraft } from "../src/client/components/ServiceItemRow";
import type { MaintenanceRow } from "../src/client/api/hooks";

/**
 * The arithmetic behind the log-service form, tested directly.
 *
 * Two things here are silent when wrong: a money total that disagrees with
 * the server by a sen looks like a rounding opinion rather than a bug, and --
 * since 2026-09-20 -- a line that sends an interval the owner did not ask for
 * rewrites the schedule with nothing on screen to say so. That second one is
 * the behaviour the owner asked to be rid of.
 */

function item(over: Partial<ItemDraft> = {}): ItemDraft {
  return {
    key: "k1",
    partTypeId: "pt_engine_oil",
    partName: "Engine oil",
    brand: "",
    spec: "",
    note: "",
    quantity: "",
    unitCost: "",
    warrantyMonths: "",
    adopting: false,
    adoptKm: "",
    adoptMonths: "",
    ...over,
  };
}

const tracked = (partTypeId: string, interval_km: number | null) =>
  ({ part_type_id: partTypeId, interval_km }) as MaintenanceRow;

describe("deriveTotals", () => {
  it("rounds each line once, in sen, and sums the rounded lines", () => {
    // 3 x RM 12.35 = RM 37.05. Rounding once per line is what the
    // line_total_cost generated column does, so the running total shown while
    // typing has to match it to the sen rather than merely to the ringgit.
    const totals = deriveTotals([item({ unitCost: "12.35", quantity: "3" })], "", 50_000, []);
    expect(totals.partsSubtotal).toBe(3705);
  });

  it("treats a blank or zero quantity as one, not as nothing", () => {
    const blank = deriveTotals([item({ unitCost: "45.00" })], "", 50_000, []);
    const zero = deriveTotals([item({ unitCost: "45.00", quantity: "0" })], "", 50_000, []);
    expect(blank.partsSubtotal).toBe(4500);
    expect(zero.partsSubtotal).toBe(4500);
  });

  it("skips a line with no cost rather than counting it as zero-priced", () => {
    const totals = deriveTotals(
      [item({ key: "a", unitCost: "" }), item({ key: "b", unitCost: "20.00" })],
      "",
      50_000,
      [],
    );
    expect(totals.partsSubtotal).toBe(2000);
  });

  it("adds labour to parts, and reports labour as null when not typed", () => {
    const withLabour = deriveTotals([item({ unitCost: "100.00" })], "35.50", 50_000, []);
    expect(withLabour.labourSen).toBe(3550);
    expect(withLabour.grandTotal).toBe(13550);

    const without = deriveTotals([item({ unitCost: "100.00" })], "", 50_000, []);
    expect(without.labourSen).toBeNull();
    expect(without.grandTotal).toBe(10000);
  });

  it("reports the SOONEST next due point, using an adopted figure where there is one", () => {
    const totals = deriveTotals(
      [
        item({ key: "a", partTypeId: "pt_a" }), // on schedule at 20,000
        item({ key: "b", partTypeId: "pt_b", adopting: true, adoptKm: "5000" }), // changed to 5,000
        item({ key: "c", partTypeId: "pt_c" }), // untracked
      ],
      "",
      50_000,
      [tracked("pt_a", 20_000), tracked("pt_b", 10_000)],
    );
    expect(totals.nextService).toBe(55_000);
  });

  it("has no next service when nothing on the visit is on a km schedule", () => {
    expect(deriveTotals([item()], "", 50_000, []).nextService).toBeUndefined();
  });

  it("flags a zero typed as a new interval, which the API would refuse", () => {
    expect(deriveTotals([item({ adopting: true, adoptKm: "0" })], "", 1, []).badItem).toBe(true);
    // Not adopting: whatever is in the fields is ignored, so not bad either.
    expect(deriveTotals([item({ adopting: false, adoptKm: "0" })], "", 1, []).badItem).toBe(false);
  });
});

describe("canSaveService", () => {
  it("requires a real, non-negative odometer and no bad line", () => {
    expect(canSaveService(50_000, false)).toBe(true);
    expect(canSaveService(0, false)).toBe(true);
    expect(canSaveService(null, false)).toBe(false);
    expect(canSaveService(-1, false)).toBe(false);
    expect(canSaveService(Number.NaN, false)).toBe(false);
    expect(canSaveService(50_000, true)).toBe(false);
  });
});

describe("toItemDrafts: the schedule changes only when asked", () => {
  it("sends NO interval for an ordinary line -- the heart of the 2026-09-20 change", () => {
    // Before, every line sent its current interval, so every service rewrote
    // the schedule. The server writes the schedule from these fields and from
    // nothing else, so their absence is what keeps it the owner's.
    const [draft] = toItemDrafts([item()]);
    expect(draft).not.toHaveProperty("intervalKmOverride");
    expect(draft).not.toHaveProperty("intervalMonthsOverride");
  });

  it("sends the adopted figures, as intervals", () => {
    const [draft] = toItemDrafts([item({ adopting: true, adoptKm: "6000", adoptMonths: "6" })]);
    expect(draft?.intervalKmOverride).toBe(6_000);
    expect(draft?.intervalMonthsOverride).toBe(6);
  });

  it("sends only the half that was filled, so the other half is kept", () => {
    const [draft] = toItemDrafts([item({ adopting: true, adoptKm: "6000" })]);
    expect(draft?.intervalKmOverride).toBe(6_000);
    expect(draft).not.toHaveProperty("intervalMonthsOverride");
  });

  it("ignores figures left in the fields after 'Keep my schedule'", () => {
    const [draft] = toItemDrafts([item({ adopting: false, adoptKm: "6000" })]);
    expect(draft).not.toHaveProperty("intervalKmOverride");
  });

  it("scales quantity to thousandths, defaulting a blank to exactly one", () => {
    const [blank] = toItemDrafts([item()]);
    const [half] = toItemDrafts([item({ quantity: "4.5" })]);
    expect(blank?.quantityMilli).toBe(1000);
    expect(half?.quantityMilli).toBe(4500);
  });

  it("trims optional text and drops it when it is blank", () => {
    const [filled] = toItemDrafts([item({ brand: "  Shell ", spec: " 5W-40 ", note: " incl. O-ring " })]);
    expect(filled?.brand).toBe("Shell");
    expect(filled?.spec).toBe("5W-40");
    expect(filled?.note).toBe("incl. O-ring");

    const [empty] = toItemDrafts([item({ brand: "   ", spec: "", note: "" })]);
    expect(empty).not.toHaveProperty("brand");
    expect(empty).not.toHaveProperty("spec");
    expect(empty).not.toHaveProperty("note");
  });

  it("converts unit cost to sen and omits it when blank", () => {
    const [priced] = toItemDrafts([item({ unitCost: "245.50" })]);
    const [unpriced] = toItemDrafts([item({ unitCost: "" })]);
    expect(priced?.unitCost).toBe(24550);
    expect(unpriced).not.toHaveProperty("unitCost");
  });
});

describe("partsResettingAClock", () => {
  it("names tracked parts and omits untracked ones", () => {
    // pt_tps has no schedule: a sensor is replaced when it fails. Listing it
    // under "Clocks reset" is the false claim that reached production on
    // 2026-09-19.
    const names = partsResettingAClock(
      [
        item({ key: "a", partTypeId: "pt_oil", partName: "Engine oil" }),
        item({ key: "b", partTypeId: "pt_tps", partName: "Throttle position sensor" }),
      ],
      [tracked("pt_oil", 10_000)],
    );
    expect(names).toEqual(["Engine oil"]);
  });

  it("names an untracked part this visit puts on the schedule", () => {
    const names = partsResettingAClock(
      [item({ partTypeId: "pt_tps", partName: "TPS", adopting: true, adoptKm: "80000" })],
      [],
    );
    expect(names).toEqual(["TPS"]);
  });

  it("agrees with what toItemDrafts sends, for untracked parts", () => {
    // For a part NOT on the schedule, the only way its clock starts is the
    // interval being sent -- so the two lists must agree exactly there.
    const items = [
      item({ key: "a", partTypeId: "pt_x", partName: "X", adopting: true, adoptMonths: "12" }),
      item({ key: "b", partTypeId: "pt_y", partName: "Y" }),
    ];
    const drafts = toItemDrafts(items);
    const sent = items
      .filter((_, i) => drafts[i]?.intervalKmOverride !== undefined || drafts[i]?.intervalMonthsOverride !== undefined)
      .map((i) => i.partName);
    expect(partsResettingAClock(items, [])).toEqual(sent);
  });
});

describe("partsChangingTheSchedule / adoptedInterval", () => {
  it("lists only lines with an adopted figure", () => {
    const items = [
      item({ key: "a", partName: "Oil", adopting: true, adoptKm: "6000" }),
      item({ key: "b", partName: "Filter" }),
      item({ key: "c", partName: "Plugs", adopting: true }), // pressed, then blanked both
    ];
    expect(partsChangingTheSchedule(items)).toEqual(["Oil"]);
    expect(adoptedInterval(items[2]!)).toBeNull();
  });
});
