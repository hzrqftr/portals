import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { todayIn, addDays } from "@portals/core";
import { as, migrate, resetDb, giveLedger, giveRule } from "./helpers";

/**
 * Writing a recurring rule: the forward-only guard, and what it must NOT stop.
 *
 * The guard exists so a rule cannot be backdated into a start that makes the
 * nightly run manufacture a backlog -- the 4,421 imported rows already cover
 * the past, and up to MAX_PER_RULE of them would come back as duplicates with
 * nothing reporting it.
 *
 * It is easy to write that guard so it also blocks ordinary editing, because
 * a rule that has been running has a start date in the past BY DEFINITION and
 * RecurringSheet resends every field on save. That bug reached production
 * (2026-09-07): every rule became uneditable the day after it started, and the
 * error named the start date while the owner was changing the day of the
 * month. Hence the second and third tests here.
 *
 * Dates are relative to the caller's today, never hardcoded: the guard reads
 * the real clock through `todayIn(scope.timezone)`, so fixed dates would pass
 * today and rot later.
 */

const OWNER = "owner@test.local";

/** The timezone helpers.ts gives every seeded user. */
const TZ = "Asia/Kuala_Lumpur";

describe("writing a recurring rule", () => {
  let ledgerId: string;
  let today: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
    today = todayIn(TZ);
  });

  it("refuses a new rule that starts in the past", async () => {
    const res = await as(OWNER)("/api/recurring", {
      method: "POST",
      json: {
        item: "Backdated",
        categoryId: "cat_utility",
        amountSen: 5400,
        direction: "out",
        intervalMonths: 1,
        dayOfMonth: 8,
        startsOn: addDays(today, -1),
      },
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/cannot start in the past/i);
  });

  /**
   * The regression. A rule that started before today is the normal case for
   * anything that has been running, and the edit sheet resends `startsOn`
   * untouched along with the field the owner actually changed.
   */
  it("lets a running rule be edited once its start date has passed", async () => {
    const started = addDays(today, -2);
    const id = await giveRule(ledgerId, { starts_on: started, day_of_month: 30 });

    // Exactly the payload RecurringSheet sends: the whole draft, including the
    // start date the owner never touched.
    const res = await as(OWNER)(`/api/recurring/${id}`, {
      method: "PATCH",
      json: {
        item: "Astro",
        description: null,
        categoryId: "cat_utility",
        vehicleId: null,
        amountSen: 5400,
        direction: "out",
        intervalMonths: 1,
        dayOfMonth: 8,
        startsOn: started,
        endsOn: null,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.dayOfMonth).toBe(8);
    expect(res.body.startsOn).toBe(started);
  });

  /**
   * The other half: allowing an UNCHANGED past start must not become
   * permission to backdate. Moving the start earlier is the case the guard was
   * written for, and it still has to fail.
   */
  it("still refuses to move a start date back into the past", async () => {
    const id = await giveRule(ledgerId, { starts_on: addDays(today, -2), day_of_month: 8 });

    const res = await as(OWNER)(`/api/recurring/${id}`, {
      method: "PATCH",
      json: { startsOn: addDays(today, -400) },
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/cannot start in the past/i);
  });

  it("still accepts a start date moved forward", async () => {
    const id = await giveRule(ledgerId, { starts_on: addDays(today, -2), day_of_month: 8 });

    const res = await as(OWNER)(`/api/recurring/${id}`, {
      method: "PATCH",
      json: { startsOn: addDays(today, 30) },
    });

    expect(res.status).toBe(200);
    expect(res.body.startsOn).toBe(addDays(today, 30));
  });
});
