import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The control plane serves this build as static files at the same origin (see
// apps/control-plane/src/server.ts), so assets are referenced from the root. In
// development the control plane runs separately and /api and /trpc are proxied to it,
// which keeps the session cookie same-origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    proxy: {
      "/trpc": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
