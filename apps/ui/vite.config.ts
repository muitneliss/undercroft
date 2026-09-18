// biome-ignore-all lint/style/noDefaultExport: The default export IS this entry point's contract -- Bun reads a server object and Vite reads a config that way, by name.

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The design uses "@/…" for src-relative imports; wire it for the build (tsconfig
    // wires it for tsc and bun test).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    // The control plane serves /trpc and the OAuth redirects; proxy them in dev.
    proxy: {
      "/trpc": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
