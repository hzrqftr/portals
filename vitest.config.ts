import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath, URL } from "node:url";

// Migrations are read once and applied to each test's isolated database, so
// the tests run against the real schema -- views, CHECK constraints, partial
// indexes, generated columns and all -- rather than a hand-maintained copy
// that can drift away from what production actually has.
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-20",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: migrations, ENVIRONMENT: "test" },
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
