import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb, giveGarage, addToGarageOf, giveVehicle } from "./helpers";

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
];

/** Markers unique to one person. If one ever appears in another's response,
 *  isolation is broken -- whichever endpoint leaked it. */
const ALICE_ITEM = "ALICE_SECRET_SALARY";
const ALICE_NOTE = "ALICE_PRIVATE_NOTE";

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
    const request = as(BOB);

    for (const path of readEndpoints) {
      const res = await request(path);
      expect([200, 404]).toContain(res.status);
      expect(res.text, `Alice's item leaked from GET ${path}`).not.toContain(ALICE_ITEM);
      expect(res.text, `Alice's note leaked from GET ${path}`).not.toContain(ALICE_NOTE);
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

  it("summary totals count only the caller's own ledger", async () => {
    await seedTransaction(ALICE, ALICE_ITEM, ALICE_NOTE);

    const bob = await as(BOB)("/api/summary");
    expect(bob.status).toBe(200);
    // Bob has no rows at all, so any figure here would be Alice's.
    expect(bob.body).toEqual([]);
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

    const request = as(CAROL);
    for (const path of readEndpoints) {
      const res = await request(path);
      expect([200, 404]).toContain(res.status);
      expect(res.text, `Alice's spending leaked to a co-member from GET ${path}`).not.toContain(
        ALICE_ITEM,
      );
      expect(res.text).not.toContain(ALICE_NOTE);
    }
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
