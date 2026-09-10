import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath, URL } from "node:url";

// Migrations are read once and applied to each test's isolated database, so
// the tests run against the real schema -- views, CHECK constraints, partial
// indexes, generated columns and all -- rather than a hand-maintained copy
// that can drift away from what production actually has.
//
// The path reaches up to the workspace root: there is ONE migrations folder for
// the one shared D1 database, and one linear sequence within it. See CLAUDE.md.
const migrations = await readD1Migrations("../../migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-20",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        // Env.DOCS is NOT optional, unlike BACKUPS -- an upload that silently
        // skips when its binding is missing would report success for a receipt
        // it never stored. Binding it here is what lets the tests exercise the
        // real path instead of a fake.
        r2Buckets: ["DOCS"],
        bindings: {
          TEST_MIGRATIONS: migrations,
          ENVIRONMENT: "test",
          ACCESS_TEAM_DOMAIN: "fleet.cloudflareaccess.test",
          ACCESS_AUD: "test-aud-tag",
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
    },
  },
});
