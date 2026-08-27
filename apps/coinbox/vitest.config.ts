import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath, URL } from "node:url";

// The SAME migrations folder Odometry reads. Coinbox's isolation suite needs
// garage_members to exist so it can prove a garage co-member cannot reach
// this portal's ledger -- a guarantee that spans both portals and can only be
// tested where both schemas are present.
const migrations = await readD1Migrations("../../migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-20",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: migrations,
          ENVIRONMENT: "test",
          ACCESS_TEAM_DOMAIN: "coinbox.cloudflareaccess.test",
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
