import { Hono } from "hono";
import type { Env, Scope } from "./types";
import { getAuthenticatedUser, resolveScope } from "./auth";
import { makeRepos, type Repos } from "./data";
import { HttpError } from "./errors";
import { ZodError } from "zod";
import { registerRoutes } from "./routes";

export type AppContext = {
  Bindings: Env;
  Variables: { scope: Scope; repos: Repos };
};

const app = new Hono<AppContext>();

/**
 * Every /api request resolves identity and scope exactly once, here, and
 * hands the handlers a set of repositories already bound to that scope.
 * Spec 5.1. Handlers below this line have no way to reach the database
 * unscoped -- that is the whole design, since D1 will not stop them.
 */
app.use("/api/*", async (c, next) => {
  const user = await getAuthenticatedUser(
    c.executionCtx as ExecutionContext,
    c.env,
    c.req.raw,
  );
  const scope = await resolveScope(c.env, user);
  c.set("scope", scope);
  c.set("repos", makeRepos(c.env, scope));
  await next();
});

registerRoutes(app);

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: "invalid", details: err.flatten() }, 422);
  }
  if (err instanceof HttpError) {
    return c.json({ error: err.code, message: err.message }, err.status as 400);
  }
  console.error("Unhandled error", err);
  return c.json({ error: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
