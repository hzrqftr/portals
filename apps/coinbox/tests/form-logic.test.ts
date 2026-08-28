import { describe, it, expect } from "vitest";
import {
  ruleFor,
  showsVehicle,
  initialFormState,
  applyCategoryChange,
  applyDirectionChange,
  isUnusualDirection,
  partitionByDirection,
} from "@shared/categoryRules";

/**
 * The entry form's interaction rules, as pure functions.
 *
 * These are here rather than in a component test because they are the part
 * that is wrong in a way nobody notices. A form that quietly overwrites a
 * direction, or submits a vehicle you can no longer see, produces rows that
 * look fine in a list and are wrong in a total. Clicking through the UI once
 * would not catch either.
 *
 * Written to fail first, per CLAUDE.md.
 */

describe("category rules", () => {
  it("defaults to money-out, because almost everything is", () => {
    // 607 of 649 real rows are outbound. An unknown category is far likelier
    // to be a new expense than a new source of income.
    expect(ruleFor("food_drinks").defaultDirection).toBe("out");
    expect(ruleFor("household").defaultDirection).toBe("out");
    expect(ruleFor(null).defaultDirection).toBe("out");
    expect(ruleFor("a_category_added_next_year").defaultDirection).toBe("out");
  });

  it("defaults to money-in only where the data is unambiguous", () => {
    expect(ruleFor("salary").defaultDirection).toBe("in");
    expect(ruleFor("extra_income").defaultDirection).toBe("in");
    expect(ruleFor("dividend").defaultDirection).toBe("in");
  });

  it("does not default Miscellaneous to money-in", () => {
    // It did, and that was wrong. The rule was derived from 2026 alone, where
    // Miscellaneous reads 12 in / 3 out. Across all 4,428 rows it is 34 in /
    // 66 out. A default tuned on a slice of the data is the failure this
    // asserts against, not the category itself.
    expect(ruleFor("miscellaneous").defaultDirection).toBe("out");
  });

  it("reveals the vehicle picker for transportation and nothing else", () => {
    expect(showsVehicle("transportation")).toBe(true);
    for (const c of ["food_drinks", "household", "salary", "insurance", null]) {
      expect(`${c}: ${showsVehicle(c)}`).toBe(`${c}: false`);
    }
  });

  it("does not constrain direction, only suggests it", () => {
    // The 8 rows that contradict their category's default are real entries in
    // Household, Family, Savings and Miscellaneous. Nothing here may make them
    // unenterable -- these are defaults, not rules.
    const unusual = applyDirectionChange(initialFormState("household"), "in");
    expect(unusual.direction).toBe("in");
    expect(isUnusualDirection(unusual)).toBe(true);
  });
});

describe("rule 1 — the direction default applies only until you touch it", () => {
  it("follows the category while the user has not chosen", () => {
    let s = initialFormState();
    expect(s.direction).toBe("out");

    s = applyCategoryChange(s, "salary");
    expect(s.direction).toBe("in");

    s = applyCategoryChange(s, "food_drinks");
    expect(s.direction).toBe("out");
  });

  it("stops following once the user picks a direction", () => {
    // The bug this prevents: pick Salary, deliberately tap `out` because this
    // one is a repayment, then correct the category -- and watch the form
    // silently put it back to `in`.
    let s = initialFormState("salary");
    expect(s.direction).toBe("in");

    s = applyDirectionChange(s, "out");
    expect(s.directionTouched).toBe(true);

    s = applyCategoryChange(s, "miscellaneous"); // would default to `in`
    expect(s.direction).toBe("out");

    s = applyCategoryChange(s, "extra_income"); // would also default to `in`
    expect(s.direction).toBe("out");
  });

  it("latches even when the tapped direction matches the current one", () => {
    // Tapping the already-selected button is still the user saying "this one",
    // and it should stop the category from second-guessing it afterwards.
    let s = initialFormState("food_drinks");
    expect(s.direction).toBe("out");

    s = applyDirectionChange(s, "out");
    s = applyCategoryChange(s, "salary");
    expect(s.direction).toBe("out");
  });
});

describe("rule 2 — hiding the vehicle field clears it", () => {
  it("keeps the vehicle while the category still shows the field", () => {
    let s = applyCategoryChange(initialFormState(), "transportation");
    s = { ...s, vehicleId: "veh_waja" };

    s = applyCategoryChange(s, "transportation");
    expect(s.vehicleId).toBe("veh_waja");
  });

  it("clears it the moment the field is hidden", () => {
    // Without this the grocery run is filed against the car, invisibly --
    // the field is no longer on screen to contradict it.
    let s = applyCategoryChange(initialFormState(), "transportation");
    s = { ...s, vehicleId: "veh_waja" };

    s = applyCategoryChange(s, "household");
    expect(s.vehicleId).toBeNull();
  });

  it("does not resurrect a cleared vehicle on the way back", () => {
    let s = applyCategoryChange(initialFormState(), "transportation");
    s = { ...s, vehicleId: "veh_city" };
    s = applyCategoryChange(s, "food_drinks");
    s = applyCategoryChange(s, "transportation");

    expect(s.vehicleId).toBeNull();
  });

  it("stays clear when moving between two categories that both hide it", () => {
    let s = applyCategoryChange(initialFormState(), "transportation");
    s = { ...s, vehicleId: "veh_rs150" };
    s = applyCategoryChange(s, "household");
    s = applyCategoryChange(s, "personal");

    expect(s.vehicleId).toBeNull();
  });
});

describe("the two rules together", () => {
  it("survives a realistic edit sequence", () => {
    // Petrol at the pump, then realising it was actually a car wash on the
    // household card -- the sort of correction that happens mid-entry.
    let s = initialFormState();

    s = applyCategoryChange(s, "transportation");
    s = { ...s, vehicleId: "veh_city" };
    expect(s.direction).toBe("out");
    expect(s.vehicleId).toBe("veh_city");

    s = applyDirectionChange(s, "in"); // a fuel refund
    s = applyCategoryChange(s, "household");

    expect(s.direction).toBe("in"); // rule 1: the user's choice held
    expect(s.vehicleId).toBeNull(); // rule 2: the hidden field was cleared
    expect(isUnusualDirection(s)).toBe(true);
  });
});

describe("rule 3 — the picker reorders, it never removes", () => {
  // The owner's 20, in seeded order.
  const ALL = [
    "transportation", "food_drinks", "household", "personal", "utility",
    "loans", "vices", "family", "extra_income", "insurance", "miscellaneous",
    "electronics", "savings", "entertainment", "salary", "medications",
    "accommodation", "dividend", "fundings", "debt",
  ].map((code) => ({ code }));

  it("floats the likely categories for money-in", () => {
    const { usual, other } = partitionByDirection(ALL, "in");
    expect(usual.map((c) => c.code)).toEqual(["extra_income", "salary", "dividend"]);
    expect(other).toHaveLength(17);
  });

  it("floats the likely categories for money-out", () => {
    const { usual, other } = partitionByDirection(ALL, "out");
    expect(usual).toHaveLength(17);
    expect(other.map((c) => c.code)).toEqual(["extra_income", "salary", "dividend"]);
  });

  it("NEVER drops a category, in either direction", () => {
    // The assertion that matters. Filtering instead of reordering would make
    // five of the owner's real rows unenterable -- RM 3,000 from his mother
    // for the roof among them.
    for (const d of ["in", "out"] as const) {
      const { usual, other } = partitionByDirection(ALL, d);
      const seen = [...usual, ...other].map((c) => c.code).sort();
      expect(`${d}: ${seen.length}`).toBe(`${d}: ${ALL.length}`);
      expect(seen).toEqual(ALL.map((c) => c.code).sort());
    }
  });

  it("keeps every category that the owner actually recorded both ways", () => {
    // household, family, savings appear as `in` in the real data; if any of
    // them vanished from the money-in picker, history could not be re-entered.
    const { usual, other } = partitionByDirection(ALL, "in");
    const reachable = [...usual, ...other].map((c) => c.code);
    for (const c of ["household", "family", "savings", "miscellaneous"]) {
      expect(`${c} reachable: ${reachable.includes(c)}`).toBe(`${c} reachable: true`);
    }
  });
});

describe("the unusual-direction hint", () => {
  it("says nothing before a category is chosen", () => {
    expect(isUnusualDirection(initialFormState())).toBe(false);
  });

  it("notes an entry that contradicts its category", () => {
    const s = applyDirectionChange(applyCategoryChange(initialFormState(), "household"), "in");
    expect(isUnusualDirection(s)).toBe(true);
  });

  it("stays quiet on the ordinary case", () => {
    const s = applyCategoryChange(initialFormState(), "food_drinks");
    expect(isUnusualDirection(s)).toBe(false);
  });
});
