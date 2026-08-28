import { Hono } from "hono";
import type { Env, Scope } from "./types";
import { getAuthenticatedUser, runScheduledBackup } from "@portals/core/worker";
import { resolveScope } from "./scope";
import { makeRepos, type Repos } from "./data";
import { HttpError } from "@portals/core/worker";
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

/**
 * Nightly whole-database export to R2. Cron is in wrangler.jsonc.
 *
 * Note what this handler does NOT do: touch env.DB. The isolation lint allows
 * that only under src/worker/{data,scope.ts,types.ts} and packages/core, and
 * this file is none of them. Passing the binding straight through to
 * runBackup() -- which lives in packages/core/src/worker/backup.ts, where the
 * lint already permits it -- keeps the rule intact rather than needing an
 * exception carved for the one caller that legitimately reads everything.
 *
 * Failures are logged and swallowed. A thrown error here would be retried by
 * the runtime and is invisible either way; `npx wrangler tail` is how you see
 * it. That silence is the known weak point of this design -- alerting needs an
 * email provider (fleet spec 12) and is not built.
 */
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env, ctx) => {
  ctx.waitUntil(
    runScheduledBackup(env, { now: new Date(event.scheduledTime) })
      .then((r) => {
        if (!r) {
          console.log("Backup skipped: no BACKUPS binding on this environment");
          return;
        }
        console.log(
          `Backup ${r.key}: ${r.rows} rows across ${r.tables} tables, ` +
            `${r.bytes} bytes` +
            (r.pruned.length ? `, pruned ${r.pruned.length} expired` : ""),
        );
      })
      .catch((err) => {
        console.error("Backup FAILED", err);
      }),
  );
};

export default { fetch: app.fetch, scheduled };
