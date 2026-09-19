import { describe, it, expect } from "vitest";
import {
  canSaveService,
  deriveTotals,
  makeDefaultNextDueKm,
  toItemDrafts,
} from "../src/client/components/serviceTotals";
import type { ItemDraft } from "../src/client/components/ServiceItemRow";
import type { MaintenanceRow, PartType } from "../src/client/api/hooks";

/**
 * The arithmetic behind the log-service form, tested directly.
 *
 * This code used to live inside ServiceSheet, where the only way to reach it
 * was to render a sheet. Both of the things it computes are silent when wrong:
 * a money total that disagrees with the server by a sen looks like a rounding
 * opinion rather than a bug, and an interval sent as a due point leaves
 * invariant 6 violated with nothing on screen able to say so.
 *
 * tests/serviceEdit.test.ts covers the same invariant from the server end --
 * correct the odometer and watch the due point move. This covers the client
 * end: the conversion that makes the API's side possible at all.
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
    nextDueKm: "",
    ...over,
  };
}

const NO_DEFAULT = () => null;

describe("deriveTotals", () => {
  it("rounds each line once, in sen, and sums the rounded lines", () => {
    // 3 x RM 12.35 = RM 37.05. Rounding once per line is what the
    // line_total_cost generated column does, so the running total shown while
    // typing has to match it to the sen rather than merely to the ringgit.
    const totals = deriveTotals(
      [item({ unitCost: "12.35", quantity: "3" })],
      "",
      50_000,
      NO_DEFAULT,
    );
    expect(totals.partsSubtotal).toBe(3705);
  });

  it("treats a blank or zero quantity as one, not as nothing", () => {
    const blank = deriveTotals([item({ unitCost: "45.00" })], "", 50_000, NO_DEFAULT);
    const zero = deriveTotals(
      [item({ unitCost: "45.00", quantity: "0" })],
      "",
      50_000,
      NO_DEFAULT,
    );
    expect(blank.partsSubtotal).toBe(4500);
    expect(zero.partsSubtotal).toBe(4500);
  });

  it("skips a line with no cost rather than counting it as zero-priced", () => {
    const totals = deriveTotals(
      [item({ key: "a", unitCost: "" }), item({ key: "b", unitCost: "20.00" })],
      "",
      50_000,
      NO_DEFAULT,
    );
    expect(totals.partsSubtotal).toBe(2000);
  });

  it("adds labour to parts, and reports labour as null when not typed", () => {
    const withLabour = deriveTotals(
      [item({ unitCost: "100.00" })],
      "35.50",
      50_000,
      NO_DEFAULT,
    );
    expect(withLabour.labourSen).toBe(3550);
    expect(withLabour.grandTotal).toBe(13550);

    const without = deriveTotals([item({ unitCost: "100.00" })], "", 50_000, NO_DEFAULT);
    expect(without.labourSen).toBeNull();
    expect(without.grandTotal).toBe(10000);
  });

  it("reports the SOONEST due figure across the lines, typed or defaulted", () => {
    const totals = deriveTotals(
      [
        item({ key: "a", partTypeId: "pt_a", nextDueKm: "70000" }),
        item({ key: "b", partTypeId: "pt_b", nextDueKm: "55000" }),
        item({ key: "c", partTypeId: "pt_c", nextDueKm: "" }),
      ],
      "",
      50_000,
      (id) => (id === "pt_c" ? 60_000 : null),
    );
    expect(totals.nextService).toBe(55_000);
  });

  it("has no next service when nothing sets one", () => {
    const totals = deriveTotals([item()], "", 50_000, NO_DEFAULT);
    expect(totals.nextService).toBeUndefined();
  });

  it("flags a line due at or before the odometer being saved", () => {
    const before = deriveTotals([item({ nextDueKm: "49000" })], "", 50_000, NO_DEFAULT);
    const equal = deriveTotals([item({ nextDueKm: "50000" })], "", 50_000, NO_DEFAULT);
    const after = deriveTotals([item({ nextDueKm: "51000" })], "", 50_000, NO_DEFAULT);
    expect(before.badItem).toBe(true);
    expect(equal.badItem).toBe(true);
    expect(after.badItem).toBe(false);
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

describe("makeDefaultNextDueKm", () => {
  const partTypes = [
    { id: "pt_oil", default_interval_km: 10_000 },
    { id: "pt_plugs", default_interval_km: null },
  ] as PartType[];

  it("prefers the vehicle's own interval over the part-type default", () => {
    const maintenance = [{ part_type_id: "pt_oil", interval_km: 7_000 }] as MaintenanceRow[];
    const resolve = makeDefaultNextDueKm(50_000, maintenance, partTypes);
    expect(resolve("pt_oil")).toBe(57_000);
  });

  it("falls back to the part-type default when the vehicle has no row", () => {
    const resolve = makeDefaultNextDueKm(50_000, [], partTypes);
    expect(resolve("pt_oil")).toBe(60_000);
  });

  it("returns null when neither side has an interval, or the odometer is blank", () => {
    expect(makeDefaultNextDueKm(50_000, [], partTypes)("pt_plugs")).toBeNull();
    expect(makeDefaultNextDueKm(null, [], partTypes)("pt_oil")).toBeNull();
  });

  it("honours a vehicle interval that has deliberately been cleared", () => {
    // A maintenance row with a null interval is an answer -- "this vehicle has
    // no schedule for this part" -- and must not fall through to the
    // catalogue default, which would silently reinstate a schedule the owner
    // removed.
    const maintenance = [{ part_type_id: "pt_oil", interval_km: null }] as MaintenanceRow[];
    expect(makeDefaultNextDueKm(50_000, maintenance, partTypes)("pt_oil")).toBeNull();
  });
});

describe("toItemDrafts", () => {
  it("sends an INTERVAL, never the absolute figure the user typed (invariant 6)", () => {
    const [draft] = toItemDrafts([item({ nextDueKm: "60000" })], 50_000, NO_DEFAULT);
    expect(draft?.intervalKmOverride).toBe(10_000);
    expect(draft).not.toHaveProperty("nextDueKm");
  });

  it("sends the interval even when the field was left at its pre-filled default", () => {
    // Leaving the field alone is an answer ("same as before"), not an absence
    // of one. If this stopped being sent, the line item and the vehicle's
    // setting could drift apart without anything reporting it.
    const [draft] = toItemDrafts([item({ nextDueKm: "" })], 50_000, () => 58_000);
    expect(draft?.intervalKmOverride).toBe(8_000);
  });

  it("omits the interval entirely when the due point is not ahead of this service", () => {
    const [behind] = toItemDrafts([item({ nextDueKm: "40000" })], 50_000, NO_DEFAULT);
    const [none] = toItemDrafts([item({ nextDueKm: "" })], 50_000, NO_DEFAULT);
    expect(behind?.intervalKmOverride).toBeUndefined();
    expect(none?.intervalKmOverride).toBeUndefined();
  });

  it("scales quantity to thousandths, defaulting a blank to exactly one", () => {
    const [blank] = toItemDrafts([item()], 50_000, NO_DEFAULT);
    const [half] = toItemDrafts([item({ quantity: "4.5" })], 50_000, NO_DEFAULT);
    expect(blank?.quantityMilli).toBe(1000);
    expect(half?.quantityMilli).toBe(4500);
  });

  it("trims optional text and drops it when it is blank", () => {
    const [filled] = toItemDrafts(
      [item({ brand: "  Shell ", spec: " 5W-40 ", note: " incl. O-ring " })],
      50_000,
      NO_DEFAULT,
    );
    expect(filled?.brand).toBe("Shell");
    expect(filled?.spec).toBe("5W-40");
    expect(filled?.note).toBe("incl. O-ring");

    const [empty] = toItemDrafts([item({ brand: "   ", spec: "", note: "" })], 50_000, NO_DEFAULT);
    expect(empty).not.toHaveProperty("brand");
    expect(empty).not.toHaveProperty("spec");
    expect(empty).not.toHaveProperty("note");
  });

  it("converts unit cost to sen and omits it when blank", () => {
    const [priced] = toItemDrafts([item({ unitCost: "245.50" })], 50_000, NO_DEFAULT);
    const [unpriced] = toItemDrafts([item({ unitCost: "" })], 50_000, NO_DEFAULT);
    expect(priced?.unitCost).toBe(24550);
    expect(unpriced).not.toHaveProperty("unitCost");
  });
});
