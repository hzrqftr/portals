import type { Hono } from "hono";
import type { AppContext } from "../index";
import {
  vehicleInput,
  vehiclePatch,
  odometerInput,
  serviceInput,
  serviceUpdate,
  renewalInput,
  renewalPatch,
  intervalPatch,
  settingsPatch,
  serviceType,
  serviceTemplatePut,
  partTypeInput,
  vehicleType,
} from "@shared/zod";
import { assertCanWrite } from "../scope";

/**
 * Route handlers. Spec 7.
 *
 * Nothing in this file imports env.DB, the Drizzle client, or Cloudflare
 * Access. Handlers parse input with Zod, call a repository that is already
 * scoped to the caller's garage, and shape the response. That is all they
 * are permitted to do, and scripts/check-db-imports.mjs fails the build if
 * one of them reaches further.
 */
export function registerRoutes(app: Hono<AppContext>): void {
  // --- identity and settings ------------------------------------------
  app.get("/api/me", async (c) => c.json(await c.get("repos").settings.me()));

  app.patch("/api/me/settings", async (c) => {
    const patch = settingsPatch.parse(await c.req.json());
    return c.json(await c.get("repos").settings.update(patch));
  });

  // --- dashboard -------------------------------------------------------
  // One request, one pre-shaped payload. Spec 7, 11.4.
  app.get("/api/dashboard", async (c) => c.json(await c.get("repos").dashboard.load()));

  // --- vehicles --------------------------------------------------------
  app.get("/api/vehicles", async (c) => c.json(await c.get("repos").vehicles.list()));

  app.post("/api/vehicles", async (c) => {
    assertCanWrite(c.get("scope"));
    const input = vehicleInput.parse(await c.req.json());
    return c.json(await c.get("repos").vehicles.create(input), 201);
  });

  app.get("/api/vehicles/:id", async (c) =>
    c.json(await c.get("repos").vehicles.get(c.req.param("id"))),
  );

  app.patch("/api/vehicles/:id", async (c) => {
    assertCanWrite(c.get("scope"));
    const patch = vehiclePatch.parse(await c.req.json());
    return c.json(await c.get("repos").vehicles.update(c.req.param("id"), patch));
  });

  app.delete("/api/vehicles/:id", async (c) => {
    assertCanWrite(c.get("scope"));
    await c.get("repos").vehicles.archive(c.req.param("id"));
    return c.body(null, 204);
  });

  // --- odometer --------------------------------------------------------
  app.get("/api/vehicles/:id/odometer", async (c) =>
    c.json(await c.get("repos").vehicles.readings(c.req.param("id"))),
  );

  app.post("/api/vehicles/:id/odometer", async (c) => {
    assertCanWrite(c.get("scope"));
    const input = odometerInput.parse(await c.req.json());
    await c.get("repos").vehicles.addReading(c.req.param("id"), input);
    return c.body(null, 204);
  });

  // --- fuel ------------------------------------------------------------

  /**
   * Fills for a vehicle, newest first, each carrying the consumption of the
   * segment it closes.
   *
   * READ ONLY, and there is no POST beside it. Fills are created from Coinbox,
   * because the litres and the ringgit are keyed in together at the pump and
   * splitting them across two apps is how odometer logging stops.
   *
   * NO MONEY APPEARS IN THIS RESPONSE. fuel_fills is garage-scoped, so anything
   * priced here would be readable by every garage co-member -- the exact leak
   * the two-axis design exists to prevent. See migration 0013.
   */
  app.get("/api/vehicles/:id/fuel", async (c) =>
    c.json(await c.get("repos").fuel.list(c.req.param("id"))),
  );

  // --- maintenance -----------------------------------------------------
  app.get("/api/vehicles/:id/maintenance", async (c) =>
    c.json(await c.get("repos").status.maintenance(c.req.param("id"))),
  );

  app.patch("/api/vehicles/:id/intervals/:pid", async (c) => {
    assertCanWrite(c.get("scope"));
    const patch = intervalPatch.parse(await c.req.json());
    return c.json(
      await c.get("repos").vehicles.setInterval(c.req.param("id"), c.req.param("pid"), patch),
    );
  });

  // --- services --------------------------------------------------------
  app.get("/api/vehicles/:id/services", async (c) =>
    c.json(await c.get("repos").services.list(c.req.param("id"))),
  );

  app.post("/api/vehicles/:id/services", async (c) => {
    assertCanWrite(c.get("scope"));
    const input = serviceInput.parse(await c.req.json());
    const id = await c.get("repos").services.create(c.req.param("id"), input);
    return c.json({ id }, 201);
  });

  app.patch("/api/services/:id", async (c) => {
    assertCanWrite(c.get("scope"));
    const input = serviceUpdate.parse(await c.req.json());
    return c.json(await c.get("repos").services.update(c.req.param("id"), input));
  });

  app.delete("/api/services/:id", async (c) => {
    assertCanWrite(c.get("scope"));
    await c.get("repos").services.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  // --- renewals --------------------------------------------------------
  app.get("/api/vehicles/:id/renewals", async (c) =>
    c.json(await c.get("repos").renewals.list(c.req.param("id"))),
  );

  app.get("/api/vehicles/:id/renewals/status", async (c) =>
    c.json(await c.get("repos").status.renewals(c.req.param("id"))),
  );

  app.post("/api/vehicles/:id/renewals", async (c) => {
    assertCanWrite(c.get("scope"));
    const input = renewalInput.parse(await c.req.json());
    const id = await c.get("repos").renewals.create(c.req.param("id"), input);
    return c.json({ id }, 201);
  });

  // Corrections only. renewalPatch is .strict() and omits every date and
  // cost field, so an attempt to re-date a renewal is a 422, not a silent
  // rewrite of cost history (invariant 8).
  app.patch("/api/renewals/:id", async (c) => {
    assertCanWrite(c.get("scope"));
    const patch = renewalPatch.parse(await c.req.json());
    return c.json(await c.get("repos").renewals.update(c.req.param("id"), patch));
  });

  // --- reference data --------------------------------------------------
  // ?vehicleType=car|motorcycle narrows the catalogue to parts that vehicle
  // actually has, and returns that type's intervals. Omitted, it returns
  // everything -- the garage-wide template editor is not about one vehicle.
  // Parsed rather than passed through: an unrecognised value must not reach
  // the JOIN and quietly return an empty catalogue.
  app.get("/api/part-types", async (c) => {
    const raw = c.req.query("vehicleType");
    const parsed = raw === undefined ? undefined : vehicleType.parse(raw);
    return c.json(await c.get("repos").partTypes.list(parsed));
  });

  app.get("/api/part-types/:id/brands", async (c) =>
    c.json(await c.get("repos").services.brandSuggestions(c.req.param("id"))),
  );

  app.post("/api/part-types", async (c) => {
    assertCanWrite(c.get("scope"));
    const input = partTypeInput.parse(await c.req.json());
    return c.json(await c.get("repos").partTypes.create(input), 201);
  });

  // --- service templates -----------------------------------------------
  // Pre-fill lists for the log-service form. These decide what the form
  // starts with and nothing else; no maintenance clock reads this table.
  app.get("/api/service-templates", async (c) =>
    c.json(await c.get("repos").serviceTemplates.list()),
  );

  app.put("/api/service-templates/:type", async (c) => {
    assertCanWrite(c.get("scope"));
    // The type comes from the URL, so it is parsed too -- an unrecognised
    // one would otherwise reach the CHECK constraint as a 500.
    const type = serviceType.parse(c.req.param("type"));
    const { partTypeIds } = serviceTemplatePut.parse(await c.req.json());
    return c.json(await c.get("repos").serviceTemplates.put(type, partTypeIds));
  });
}
