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
  // PINNED, and strictly. Both portals used to default to 5173 and race for
  // it, so whichever started second silently moved to 5174 -- which is why
  // docs/status.md used to say "run one at a time". The cross-portal header
  // link needs a deterministic address for the sibling (Odometry on
  // 5174), so a port that drifts would make that link wrong rather than
  // merely inconvenient. strictPort fails loudly instead of drifting.
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist" },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
    },
  },
});
