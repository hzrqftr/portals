import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    // Shared local state with Odometry, mirroring the shared production D1.
    // Two portals on one database must be one database locally too, or a
    // transaction written here cannot see the vehicle it references.
    cloudflare({ persistState: { path: "../../.wrangler/state" } }),
  ],
  build: { outDir: "dist" },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
    },
  },
});
