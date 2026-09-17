import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // The control plane serves /trpc and the OAuth redirects; proxy them in dev.
    proxy: {
      "/trpc": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
