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
    // The INSPECTOR port needs pinning for the same reason the HTTP port above
    // does, and it is a separate port. Both portals defaulted to 9229, so the
    // second one to start died with EADDRINUSE on 127.0.0.1:9229 -- an error
    // naming a port neither config mentions, while the HTTP ports were already
    // correct. Coinbox 9229, Odometry 9230.
    cloudflare({
      persistState: { path: "../../.wrangler/state" },
      inspectorPort: 9230,
    }),
  ],
  // PINNED, and strictly. Both portals used to default to 5173 and race for
  // it, so whichever started second silently moved to 5174 -- which is why
  // docs/status.md used to say "run one at a time". The cross-portal header
  // link needs a deterministic address for the sibling (Coinbox on
  // 5173), so a port that drifts would make that link wrong rather than
  // merely inconvenient. strictPort fails loudly instead of drifting.
  server: { port: 5174, strictPort: true },
  build: { outDir: "dist" },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
    },
  },
});
