import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    // persistState points at the WORKSPACE ROOT, not this app. Both portals share
    // one D1 database in production, so they must share one local database too --
    // otherwise `npm run dev` in each app gets its own private copy and local
    // behaviour stops resembling deployed behaviour. See CLAUDE.md.
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
