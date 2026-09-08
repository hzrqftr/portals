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
    // The INSPECTOR port needs pinning for the same reason the HTTP port above
    // does, and it is a separate port. Both portals defaulted to 9229, so the
    // second one to start died with EADDRINUSE on 127.0.0.1:9229 -- an error
    // naming a port neither config mentions, while the HTTP ports were already
    // correct. Coinbox 9229, Odometry 9230.
    cloudflare({
      persistState: { path: "../../.wrangler/state" },
      inspectorPort: 9229,
    }),
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
