import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  as,
  migrate,
  resetDb,
  giveGarage,
  addToGarageOf,
  giveVehicle,
  giveRule,
  removeFromGarageOf,
} from "./helpers";
import { runRecurringPosting } from "@worker/data/recurring-runner";

/**
 * THE MOST IMPORTANT TEST IN THIS PORTAL.
 *
 * D1 has no row-level security. The only thing between one person's ledger
 * and another's is that every query carries `WHERE ledger_id = ?`, and
 * nothing behind this code will catch a missing predicate -- the database
 * will hand the rows over without complaint.
 *
 * WHEN YOU ADD AN ENDPOINT, ADD IT TO `readEndpoints`. No exceptions.
 *
 * The second describe block is the one this portal exists to satisfy. Both
 * portals share one database and one `users` table, and Odometry's tenant is
 * a GARAGE which is designed to be shared by a household. So the dangerous
 * case is not two strangers -- it is two people who legitimately share a
 * garage. Adding someone to your garage so they can see service schedules
 * must never let them see your salary.
 */

const ALICE = "alice@test.local";
const BOB = "bob@test.local";
const CAROL = "carol@test.local";

/** Every GET a caller can make. Grows with the API. */
const readEndpoints = [
  "/api/me",
  "/api/categories",
  "/api/vehicles",
  "/api/transactions",
  "/api/summary",
  "/api/recurring",
  "/api/dashboard",
];

/** Markers unique to one person. If one ever appears in another's response,
 *  isolation is broken -- whichever endpoint leaked it. */
const ALICE_ITEM = "ALICE_SECRET_SALARY";
const ALICE_NOTE = "ALICE_PRIVATE_NOTE";
/** Recurring rules carry their own text, so they need their own marker. The
 *  sweep loops only look for these strings -- a new resource whose content is
 *  never seeded would be swept vacuously and prove nothing. */
const ALICE_RULE = "ALICE_SECRET_STANDING_ORDER";

async function seedTransaction(email: string, item: string, description: string) {
  const res = await as(email)("/api/transactions", {
    method: "POST",
    json: {
      occurredOn: "2026-08-28",
      item,
      description,
      categoryId: "cat_food_drinks",
      amountSen: 12_345,
      direction: "out",
    },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function seedRecurring(email: string, item: string) {
  const res = await as(email)("/api/recurring", {
    method: "POST",
    json: {
      item,
      categoryId: "cat_food_drinks",
      amountSen: 23_000,
      direction: "out",
      intervalMonths: 1,
      dayOfMonth: 15,
      // Forward-only is enforced against the caller's today, so a fixed past
      // date here would 422 and the test would prove nothing.
      startsOn: "2099-01-01",
    },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(migrate);
beforeEach(resetDb);

describe("cross-tenant isolation: separate people", () => {
  it("gives two people different ledgers", async () => {
    const a = await as(ALICE)("/api/me");
    const b = await as(BOB)("/api/me");

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.ledgerId).toBeTruthy();
    expect(b.body.ledgerId).toBeTruthy();
    expect(a.body.ledgerId).not.toBe(b.body.ledgerId);
    expect(a.body.userId).not.toBe(b.body.userId);
  });

  it("never returns another person's ledger id on any read endpoint", async () => {
    const bobLedger = (await as(BOB)("/api/me")).body.ledgerId as string;
    const request = as(ALICE);

    for (const path of readEndpoints) {
      const res = await request(path);
      expect([200, 404]).toContain(res.status);
      expect(res.text, `Bob's ledger leaked from GET ${path}`).not.toContain(bobLedger);
    }
  });

  it("never returns another person's transactions on any read endpoint", async () => {
    await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);
    await seedRecurring(ALICE, ALICE_RULE);
    const request = as(BOB);

    for (const path of readEndpoints) {
      const res = await request(path);
      expect([200, 404]).toContain(res.status);
      expect(res.text, `Alice's item leaked from GET ${path}`).not.toContain(ALICE_ITEM);
      expect(res.text, `Alice's note leaked from GET ${path}`).not.toContain(ALICE_NOTE);
      expect(res.text, `Alice's rule leaked from GET ${path}`).not.toContain(ALICE_RULE);
    }
  });

  it("404s rather than serving another person's transaction by id", async () => {
    const id = await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);

    const res = await as(BOB)(`/api/transactions/${id}`);
    // NotFound, never Forbidden: a 403 would confirm the id exists.
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(ALICE_ITEM);
  });

  it("refuses to let one person edit another's transaction", async () => {
    const id = await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);

    const res = await as(BOB)(`/api/transactions/${id}`, {
      method: "PATCH",
      json: { item: "HIJACKED" },
    });
    expect(res.status).toBe(404);

    const still = await as(ALICE)(`/api/transactions/${id}`);
    expect(still.body.item).toBe(ALICE_ITEM);
  });

  /**
   * THE MOST DANGEROUS NEW ENDPOINT IN THIS PORTAL.
   *
   * Every other missing-predicate bug here LEAKS data. This one DESTROYS it,
   * and destroys someone else's. That asymmetry is why TransactionRepo.remove
   * carries two guards -- get() to prove ownership and the ledger predicate on
   * the DELETE itself -- rather than trusting the call above it.
   */
  it("refuses to let one person delete another's transaction", async () => {
    const id = await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);

    const res = await as(BOB)(`/api/transactions/${id}`, { method: "DELETE" });
    // NotFound, never Forbidden: a 403 would confirm the id exists.
    expect(res.status).toBe(404);
  });

  /**
   * Deliberately SEPARATE from the 404 above, and not merged into it.
   *
   * remove() has two guards -- get() proves ownership, and the DELETE carries
   * the ledger predicate again. If both assertions lived in one test, the
   * status check would fail first and mask whether the row survived, so
   * removing the second guard would look identical to removing the first.
   * Split, the outcomes are distinguishable: break get() and only the test
   * above fails; break both and this one fails too, which is the case where
   * data is actually destroyed.
   */
  it("leaves the other person's transaction intact after a refused delete", async () => {
    const id = await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);

    await as(BOB)(`/api/transactions/${id}`, { method: "DELETE" });

    const still = await as(ALICE)(`/api/transactions/${id}`);
    expect(still.status).toBe(200);
    expect(still.body.item).toBe(ALICE_ITEM);
  });

  it("refuses to let one person edit or delete another's recurring rule", async () => {
    const id = await seedRecurring(ALICE, ALICE_RULE);

    const patch = await as(BOB)(`/api/recurring/${id}`, {
      method: "PATCH",
      json: { item: "HIJACKED" },
    });
    expect(patch.status).toBe(404);

    const del = await as(BOB)(`/api/recurring/${id}`, { method: "DELETE" });
    expect(del.status).toBe(404);

    const still = await as(ALICE)(`/api/recurring/${id}`);
    expect(still.status).toBe(200);
    expect(still.body.item).toBe(ALICE_RULE);
  });

  it("summary totals count only the caller's own ledger", async () => {
    await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);

    const bob = await as(BOB)("/api/summary");
    expect(bob.status).toBe(200);
    // Bob has no rows at all, so any figure here would be Alice's.
    expect(bob.body).toEqual([]);
  });

  it("dashboard figures count only the caller's own ledger", async () => {
    await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);
    await seedRecurring(ALICE, ALICE_RULE);

    const bob = await as(BOB)("/api/dashboard");
    expect(bob.status).toBe(200);
    // Bob has nothing at all, so any non-zero figure here is Alice's money
    // arriving through a query that forgot its predicate.
    expect(bob.body.months).toEqual([]);
    expect(bob.body.ytdNetSen).toBe(0);
    expect(bob.body.focus.netSen).toBe(0);
    expect(bob.body.focus.categories).toEqual([]);
    expect(bob.body.committed.netSen).toBe(0);
    expect(bob.body.committed.upcoming).toEqual([]);
    expect(bob.body.vehicles).toEqual([]);
    expect(bob.body.lastEntryOn).toBeNull();
  });

  it("bootstraps exactly one ledger per person, however many requests arrive", async () => {
    await as(ALICE)("/api/me");
    await as(ALICE)("/api/me");
    await as(ALICE)("/api/me");

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ledgers l
         JOIN users u ON u.id = l.owner_user_id
        WHERE u.email = ?`,
    )
      .bind(ALICE)
      .first<{ n: number }>();

    expect(count?.n).toBe(1);
  });
});

describe("cross-user isolation: co-members of one garage", () => {
  beforeEach(async () => {
    // Both exist as users, and Alice owns a garage.
    await as(ALICE)("/api/me");
    await as(CAROL)("/api/me");
    await giveGarage(ALICE);
    // Carol can now see Alice's vehicles in Odometry. That is correct and
    // intended. What must NOT follow is any access to Alice's ledger.
    await addToGarageOf(ALICE, CAROL);
  });

  it("puts Carol in Alice's garage (fixture sanity)", async () => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM garage_members gm
         JOIN users u ON u.id = gm.user_id
         JOIN garages g ON g.id = gm.garage_id
         JOIN users owner ON owner.id = g.created_by
        WHERE u.email = ? AND owner.email = ?`,
    )
      .bind(CAROL, ALICE)
      .first<{ n: number }>();

    // If this fails the rest of this block proves nothing -- it would be
    // asserting isolation between two people who share no garage at all.
    expect(row?.n).toBe(1);
  });

  it("still gives a garage co-member their own separate ledger", async () => {
    const alice = await as(ALICE)("/api/me");
    const carol = await as(CAROL)("/api/me");

    expect(carol.body.ledgerId).not.toBe(alice.body.ledgerId);
  });

  it("never leaks the garage owner's ledger to a co-member", async () => {
    const aliceLedger = (await as(ALICE)("/api/me")).body.ledgerId as string;
    const request = as(CAROL);

    for (const path of readEndpoints) {
      const res = await request(path);
      expect([200, 404]).toContain(res.status);
      expect(res.text, `Alice's ledger leaked to a garage co-member from GET ${path}`).not.toContain(
        aliceLedger,
      );
    }
  });

  it("DOES show a co-member the garage's vehicles -- that is the point of a garage", async () => {
    // Not a leak. Sharing a fleet is exactly what a garage is for, and this
    // endpoint answers Odometry's question on purpose. Asserted so that
    // someone "fixing" it later has to argue with a test rather than a
    // comment.
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    const res = await as(CAROL)("/api/vehicles");
    expect(res.status).toBe(200);
    expect(res.text).toContain("SHARED_WAJA");
    expect(res.body.map((v: { id: string }) => v.id)).toContain(vehicleId);
  });

  it("but never the garage owner's transactions", async () => {
    // The whole two-axis design exists for this one assertion: Carol can see
    // Alice's car and must not see Alice's spending.
    await giveVehicle(ALICE, "SHARED_WAJA");
    await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);
    await seedRecurring(ALICE, ALICE_RULE);

    const request = as(CAROL);
    for (const path of readEndpoints) {
      const res = await request(path);
      expect([200, 404]).toContain(res.status);
      expect(res.text, `Alice's spending leaked to a co-member from GET ${path}`).not.toContain(
        ALICE_ITEM,
      );
      expect(res.text).not.toContain(ALICE_NOTE);
      expect(
        res.text,
        `Alice's recurring rule leaked to a co-member from GET ${path}`,
      ).not.toContain(ALICE_RULE);
    }
  });

  /**
   * THE ONLY CROSS-PORTAL READ IN THIS PORTAL.
   *
   * Cost per kilometre divides Coinbox spend by Odometry distance, so it is
   * the one query that touches the other portal's tables. Carol shares the
   * garage, so she can legitimately SEE the car -- and the money spent on it
   * is still Alice's. A dashboard that grouped by vehicle without the ledger
   * predicate would hand Carol a per-vehicle total of Alice's fuel bills, and
   * every other test in this file would still pass.
   */
  it("never shows a co-member the garage owner's spend on a shared vehicle", async () => {
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    const alice = await as(ALICE)("/api/transactions", {
      method: "POST",
      json: {
        occurredOn: "2026-08-28",
        item: ALICE_ITEM,
        categoryId: "cat_transportation",
        vehicleId,
        amountSen: 99_999,
        direction: "out",
      },
    });
    expect(alice.status).toBe(201);

    // Alice sees her own figure for the car she paid for.
    const hers = await as(ALICE)("/api/dashboard");
    expect(hers.body.vehicles.map((v: { vehicleId: string }) => v.vehicleId)).toContain(
      vehicleId,
    );

    // Carol sees the car in /api/vehicles and no money against it here.
    const carol = await as(CAROL)("/api/dashboard");
    expect(carol.status).toBe(200);
    expect(carol.body.vehicles).toEqual([]);
    expect(carol.text).not.toContain("99999");
    expect(carol.text).not.toContain(ALICE_ITEM);
  });

  /**
   * The SECOND guard on the cost-per-km query, which the test above does not
   * reach: with the ledger predicate intact, Carol gets nothing whether or not
   * the garage join is there.
   *
   * `transactions.vehicle_id` deliberately carries NO foreign key, so that
   * deleting a garage cannot cascade into financial history. The cost is that
   * a vehicle_id can outlive the caller's access to that vehicle. Losing the
   * garage join would then keep reporting a car's nickname and mileage to
   * someone who can no longer open it in Odometry.
   */
  it("stops reporting a vehicle once the caller loses garage access to it", async () => {
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    const created = await as(CAROL)("/api/transactions", {
      method: "POST",
      json: {
        occurredOn: "2026-08-28",
        item: "Carol fuel",
        categoryId: "cat_transportation",
        vehicleId,
        amountSen: 5_000,
        direction: "out",
      },
    });
    expect(created.status).toBe(201);

    // While she is in the garage, it is hers to see.
    const before = await as(CAROL)("/api/dashboard");
    expect(before.body.vehicles.map((v: { vehicleId: string }) => v.vehicleId)).toContain(
      vehicleId,
    );

    // Access revoked. The spend row survives on purpose -- the money was real,
    // and `transactions.vehicle_id` carries no foreign key precisely so that
    // losing a garage cannot reach into financial history.
    await removeFromGarageOf(ALICE, CAROL);

    const after = await as(CAROL)("/api/dashboard");
    expect(after.status).toBe(200);
    expect(after.body.vehicles).toEqual([]);
    expect(after.text).not.toContain("SHARED_WAJA");
  });

  it("lets a co-member attach a shared vehicle to their OWN transaction", async () => {
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    const res = await as(CAROL)("/api/transactions", {
      method: "POST",
      json: {
        occurredOn: "2026-08-28",
        item: "Carol fuel",
        categoryId: "cat_transportation",
        vehicleId,
        amountSen: 5_000,
        direction: "out",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.vehicleId).toBe(vehicleId);
  });

  it("lets a co-member attach a shared vehicle to their OWN recurring rule", async () => {
    // A recurring rule is the SECOND write path where the two ownership axes
    // meet, and the harder one: it authorises a vehicle now and writes with it
    // months later. Creation must behave exactly like a transaction's.
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    const res = await as(CAROL)("/api/recurring", {
      method: "POST",
      json: {
        item: "Carol car insurance",
        categoryId: "cat_transportation",
        vehicleId,
        amountSen: 23_000,
        direction: "out",
        intervalMonths: 1,
        dayOfMonth: 15,
        startsOn: "2099-01-01",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.vehicleId).toBe(vehicleId);
  });

  it("refuses a recurring rule naming a vehicle the caller cannot reach", async () => {
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    // Bob is in no garage. 404 rather than 403, so a crafted id cannot be used
    // to enumerate which vehicles exist.
    const res = await as(BOB)("/api/recurring", {
      method: "POST",
      json: {
        item: "Bob tries it on",
        categoryId: "cat_transportation",
        vehicleId,
        amountSen: 1_000,
        direction: "out",
        intervalMonths: 1,
        dayOfMonth: 15,
        startsOn: "2099-01-01",
      },
    });
    expect(res.status).toBe(404);
  });

  it("refuses a vehicle the caller has no garage membership for", async () => {
    // Never trust an ID from the client. Bob is in no garage, so Alice's
    // vehicle must be unusable to him -- and must 404 rather than 403, so a
    // crafted id cannot be used to discover which vehicles exist.
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    const res = await as(BOB)("/api/transactions", {
      method: "POST",
      json: {
        occurredOn: "2026-08-28",
        item: "Bob fuel",
        categoryId: "cat_transportation",
        vehicleId,
        amountSen: 5_000,
        direction: "out",
      },
    });
    expect(res.status).toBe(404);
  });

  it("does not put a garage id anywhere in the scope", async () => {
    // A garageId on the scope object is how this leak would actually happen:
    // someone adds it "just for the vehicle picker", and a later query filters
    // by it. Assert it never appears.
    const res = await as(CAROL)("/api/me");
    expect(Object.keys(res.body)).not.toContain("garageId");
  });
});

/**
 * The scheduled runner writes into every ledger with work to do, so it is the
 * one caller in this portal with no Cloudflare Access identity behind it.
 *
 * These live in the isolation suite rather than beside the other cron tests on
 * purpose: this is a tenancy guarantee, and the file that sweeps every read
 * endpoint is where someone changing the scoping model will look. A runner
 * that built one Scope and reused it, or that dropped `this.where()` on the
 * insert, would post one person's commitments into another's ledger -- and
 * every existing test in this file would still pass.
 */
describe("cross-tenant isolation: the scheduled runner", () => {
  const DUE_DAY = new Date("2026-09-15T02:00:00.000Z");

  it("posts each ledger's entries into that ledger and no other", async () => {
    const alice = (await as(ALICE)("/api/me")).body.ledgerId as string;
    const bob = (await as(BOB)("/api/me")).body.ledgerId as string;

    await giveRule(alice, { item: ALICE_ITEM, starts_on: "2026-09-01", day_of_month: 15 });
    await giveRule(bob, { item: "BOB_OWN_RULE", starts_on: "2026-09-01", day_of_month: 15 });

    const result = await runRecurringPosting(env, { now: DUE_DAY });
    expect(result.posted).toBe(2);

    // Each got exactly their own, and the sweep proves the other's never
    // surfaces on ANY read endpoint -- not just the obvious one.
    const bobLedger = as(BOB);
    for (const path of readEndpoints) {
      const res = await bobLedger(path);
      expect([200, 404]).toContain(res.status);
      expect(res.text, `Alice's posted entry leaked from GET ${path}`).not.toContain(ALICE_ITEM);
      expect(res.text, `Alice's ledger id leaked from GET ${path}`).not.toContain(alice);
    }

    const bobTxns = await as(BOB)("/api/transactions");
    expect(bobTxns.body).toHaveLength(1);
    expect(bobTxns.body[0].item).toBe("BOB_OWN_RULE");
  });

  it("does not post a co-member's garage-shared rule into the wrong ledger", async () => {
    const alice = (await as(ALICE)("/api/me")).body.ledgerId as string;
    await as(CAROL)("/api/me");
    await giveGarage(ALICE);
    await addToGarageOf(ALICE, CAROL);
    const vehicleId = await giveVehicle(ALICE, "SHARED_WAJA");

    // Alice's rule names the shared car. Carol is in the garage, so she can
    // SEE that car -- and must still get none of the money.
    await giveRule(alice, {
      item: ALICE_ITEM,
      starts_on: "2026-09-01",
      day_of_month: 15,
      vehicle_id: vehicleId,
    });

    await runRecurringPosting(env, { now: DUE_DAY });

    const carol = await as(CAROL)("/api/transactions");
    expect(carol.body).toHaveLength(0);
    expect(carol.text).not.toContain(ALICE_ITEM);
  });
});
