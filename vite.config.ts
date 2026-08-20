import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: { outDir: "dist" },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
    },
  },
});
