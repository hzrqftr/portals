import { describe, expect, it } from "vitest";
import {
  applyFillToggle,
  applyVehicleChange,
  fuelWarning,
  initialFuelState,
  isFuelComplete,
  parseLitresMilli,
  parseOdometerKm,
  senPerLitre,
} from "@shared/fuelRules";

/**
 * Pure unit tests, no D1. These rules decide what gets SUBMITTED, and the
 * failure they guard against is a value that is no longer on screen still being
 * sent -- which is invisible from the form and permanent once it reaches
 * Odometry.
 */

describe("hiding the block clears it", () => {
  const filled = {
    isFill: true,
    odometerKm: "50000",
    litres: "43.9",
    isFullTank: false,
  };

  /**
   * The same rule as the vehicle picker's Rule 2 in categoryRules.ts. Tick
   * fill-up, key in an odometer, change your mind and untick: without this the
   * reading is still written, and the field is no longer on screen to
   * contradict it.
   */
  it("drops the odometer and litres when the toggle goes off", () => {
    expect(applyFillToggle(filled, false)).toEqual(initialFuelState());
  });

  it("keeps them while the toggle stays on", () => {
    expect(applyFillToggle(filled, true)).toEqual(filled);
  });

  it("drops everything when the vehicle is cleared", () => {
    expect(applyVehicleChange(filled, null)).toEqual(initialFuelState());
  });

  it("keeps everything while a vehicle is chosen", () => {
    expect(applyVehicleChange(filled, "v1")).toEqual(filled);
  });

  /** Defaulting to a full tank matches reality; the part fill is the deliberate tap. */
  it("starts as not-a-fill, with a full tank assumed", () => {
    expect(initialFuelState()).toEqual({
      isFill: false,
      odometerKm: "",
      litres: "",
      isFullTank: true,
    });
  });
});

describe("completeness", () => {
  it("does not block an entry that is not a fill", () => {
    expect(isFuelComplete(initialFuelState())).toBe(true);
  });

  it("blocks a half-filled block", () => {
    expect(isFuelComplete({ ...initialFuelState(), isFill: true, odometerKm: "50000" })).toBe(
      false,
    );
    expect(isFuelComplete({ ...initialFuelState(), isFill: true, litres: "40" })).toBe(false);
  });

  it("allows a complete one", () => {
    expect(
      isFuelComplete({ isFill: true, odometerKm: "50000", litres: "40", isFullTank: true }),
    ).toBe(true);
  });
});

describe("parsing", () => {
  it("reads litres as integer thousandths", () => {
    expect(parseLitresMilli("43.902")).toBe(43_902);
    expect(parseLitresMilli("40")).toBe(40_000);
    expect(parseLitresMilli("0.5")).toBe(500);
  });

  /** Zero litres is not a fill, unlike zero ringgit which is a real water bill. */
  it("rejects zero, blank and rubbish litres", () => {
    expect(parseLitresMilli("0")).toBeNull();
    expect(parseLitresMilli("")).toBeNull();
    expect(parseLitresMilli("abc")).toBeNull();
  });

  it("reads whole kilometres only", () => {
    expect(parseOdometerKm("50000")).toBe(50_000);
    expect(parseOdometerKm("50,000")).toBe(50_000);
    expect(parseOdometerKm("")).toBeNull();
  });
});

describe("price per litre is derived, never typed", () => {
  it("divides the amount by the litres", () => {
    // RM 90.00 over 43.902 L is RM 2.05 per litre, which is RON95.
    expect(senPerLitre(9_000, 43_902)).toBe(205);
  });

  it("is null when either half is missing", () => {
    expect(senPerLitre(null, 40_000)).toBeNull();
    expect(senPerLitre(9_000, null)).toBeNull();
    expect(senPerLitre(9_000, 0)).toBeNull();
  });
});

describe("the plausibility warning", () => {
  /**
   * THE ONLY DEFENCE against a typo ABOVE the last reading. The API rejects a
   * reading lower than an earlier one, but 112,000 keyed for 12,000 is higher
   * than everything before it and therefore looks exactly like a real reading.
   * Readings have no correction path, so that mistake is permanent.
   */
  it("flags an odometer that is implausibly far ahead", () => {
    // 40 L over 62,000 km is 0.06 L/100km. Nobody gets that.
    expect(fuelWarning(40_000, 112_000, 50_000)).toMatch(/too good/);
  });

  it("flags an implausibly thirsty segment", () => {
    // 40 L over 50 km is 80 L/100km.
    expect(fuelWarning(40_000, 50_050, 50_000)).toMatch(/looks high/);
  });

  it("flags an odometer that has not moved", () => {
    expect(fuelWarning(40_000, 50_000, 50_000)).toMatch(/not ahead/);
  });

  it("says nothing about an ordinary fill", () => {
    // 40 L over 500 km is 8.0 L/100km.
    expect(fuelWarning(40_000, 50_500, 50_000)).toBeNull();
  });

  /**
   * A vehicle with no previous reading has nothing to compare against, and a
   * warning invented from no data is worse than silence.
   */
  it("says nothing when there is no previous reading", () => {
    expect(fuelWarning(40_000, 50_000, null)).toBeNull();
  });

  /**
   * The bounds are wide on purpose. A small car is around 6 L/100km and a laden
   * pickup around 15; these must not nag about either.
   */
  it("leaves the whole realistic range alone", () => {
    for (const lPer100 of [4, 6, 8, 10, 12, 15, 20]) {
      const distance = 500;
      const litresMilli = Math.round(lPer100 * distance * 10);
      expect(fuelWarning(litresMilli, 50_000 + distance, 50_000)).toBeNull();
    }
  });
});
