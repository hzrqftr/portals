import { Hono } from "hono";
import { ZodError } from "zod";
import type { Env, Scope } from "./types";
import { getAuthenticatedUser, HttpError } from "@portals/core/worker";
import { resolveLedgerScope } from "./scope";
import { makeRepos, type Repos } from "./data";
import { registerRoutes } from "./routes";

export type AppContext = {
  Bindings: Env;
  Variables: { scope: Scope; repos: Repos };
};

const app = new Hono<AppContext>();

/**
 * Identity, then scope, then repositories -- in that order, for every /api/*
 * request. A handler cannot run before the ledger is known, so there is no
 * path by which one could query without a tenant predicate.
 *
 * Static assets never reach this Worker: `run_worker_first: ["/api/*"]` in
 * wrangler.jsonc means the assets runtime serves everything else first.
 */
app.use("/api/*", async (c, next) => {
  const user = await getAuthenticatedUser(c.executionCtx as ExecutionContext, c.env, c.req.raw);
  const scope = await resolveLedgerScope(c.env, user);
  c.set("scope", scope);
  c.set("repos", makeRepos(c.env, scope));
  await next();
});

registerRoutes(app);

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: "invalid", details: err.flatten() }, 422);
  if (err instanceof HttpError) {
    return c.json({ error: err.code, message: err.message }, err.status as 400);
  }
  console.error("Unhandled error", err);
  return c.json({ error: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
