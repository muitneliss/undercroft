import { fileURLToPath, URL } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";

// A separate HTML entry keeps fixture data and the local transport out of the shipped SPA.
export default mergeConfig(
  base,
  defineConfig({
    plugins: [
      {
        name: "models-prototype-entry",
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            if (["/api", "/trpc", "/oauth", "/mcp"].some((path) => request.url?.startsWith(path))) {
              _response.statusCode = 403;
              _response.end("Read-only synthetic prototype");
              return;
            }
            if (request.headers.accept?.includes("text/html")) {
              request.url = "/prototype/index.html";
            }
            next();
          });
        },
      },
    ],
    build: {
      outDir: "dist/prototype",
      rollupOptions: { input: fileURLToPath(new URL("./prototype/index.html", import.meta.url)) },
    },
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {},
      watch: { awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 } },
    },
  }),
);
