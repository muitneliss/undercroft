import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Tests must not reach the network. MSW is configured to error on an
    // unhandled request, so a component that calls an endpoint nobody modelled
    // fails loudly here instead of silently in a browser.
    restoreMocks: true,
  },
});
