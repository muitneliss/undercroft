import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API serves this build as static files, so assets are referenced from the
// root. In development the API runs separately and /api is proxied to it, which
// keeps the session cookie same-origin -- a cross-origin dev setup would need
// SameSite=None and would stop resembling production exactly where it matters.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VCDO_API_URL ?? "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
