import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type Rollup } from "vite";

/**
 * The release tag, stamped into the bundle at build time.
 *
 * Read from the ROOT package.json, which release-please owns: merging the release PR
 * writes `version` there and cuts the tag `v<version>` from that same commit, and the
 * images are built from it. So in any image that ships, this string is exactly the tag an
 * operator would put in `IMAGE_TAG` to roll back to it -- which is why the `v` is kept
 * rather than stripped. `apps/ui/package.json` is deliberately not the source: nothing
 * bumps it, and a stamp nobody maintains is worse than none.
 *
 * `src/test/setup.ts` stamps the same value for `bun test`, which does not run this file.
 * The two reads are duplicated on purpose: they are two build harnesses, and a module
 * shared between them would have to live under `src/` and reach for `node:fs`, which is
 * the import that fails a browser bundle (see the gate note in CLAUDE.md).
 */
const release: string = ((): string => {
  const root = fileURLToPath(new URL("../../package.json", import.meta.url));
  const { version } = JSON.parse(readFileSync(root, "utf8")) as { version: string };
  return `v${version}`;
})();

/**
 * The release beacon: a service worker whose only content is the release it was built from.
 *
 * A tab keeps running the bundle it loaded, so after a deploy it is the previous release,
 * talking to the new server, until somebody reloads it. The browser already re-fetches a
 * registered worker's script and fires `updatefound` when its bytes change, and this
 * script's bytes change exactly when the release does -- so the browser's own update check
 * becomes the tab's "a new release is live" signal (`src/lib/releaseWatch.ts`). ADR 0055.
 *
 * Deliberately NO `fetch` listener and no cache. A worker that intercepts requests is a
 * second copy of the app that can outlive a deploy, which is the very defect this exists to
 * report; this one is never on the path of a request, `/trpc` and sign-in included.
 *
 * `skipWaiting` because the worker holds nothing a running tab depends on. Left waiting, it
 * would still be waiting after the reload it asked for, and the reloaded tab -- already on
 * the new release -- could not tell a stale worker from a fresh one.
 *
 * It answers any message by posting its release to the port it was sent, which is the whole
 * protocol: there is nothing else to ask it.
 *
 * Emitted at a FIXED name at the root rather than hashed into `assets/`: the worker's URL is
 * its identity, and a new URL would be a second registration rather than an update. The
 * control plane serves it with `no-cache` for the same reason (`handlers/server.ts`). Build
 * only: under `vite serve` there is no release to announce, and `main.tsx` registers nothing.
 */
function releaseBeacon(stamp: string): Plugin {
  const source = [
    "// Undercroft's release beacon, written by apps/ui/vite.config.ts. ADR 0055.",
    `const RELEASE = ${JSON.stringify(stamp)};`,
    `self.addEventListener("install", () => self.skipWaiting());`,
    `self.addEventListener("message", (event) => event.ports[0]?.postMessage(RELEASE));`,
    "",
  ].join("\n");
  return {
    name: "undercroft-release-beacon",
    apply: "build",
    generateBundle(this: Rollup.PluginContext): void {
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/** Where `task dev:api` put the control plane. Vite runs in Node, so `process.env` is right here. */
const apiOrigin = `http://localhost:${process.env.UNDERCROFT_API_PORT ?? "3000"}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), releaseBeacon(release)],
  define: {
    __UNDERCROFT_RELEASE__: JSON.stringify(release),
  },
  resolve: {
    // The design uses "@/…" for src-relative imports; wire it for the build (tsconfig
    // wires it for tsc and bun test).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // The editor is its own chunk, loaded only on the three leaves that hold one (see
    // `components/SqlEditor.tsx`). Vite's default warns at 500 kB; the warning exists to
    // catch a heavy module riding in the main bundle, which this one does not. The waiver
    // was 4000 while that chunk was Monaco -- CodeMirror is an order of magnitude smaller,
    // so the ceiling comes back down to where it can still catch something.
    chunkSizeWarningLimit: 700,
  },
  server: {
    // The control plane serves /trpc, the OAuth redirects and /mcp (ADR 0059); proxy them in
    // dev, so a model-context client pointed at this origin reaches the same door.
    //
    // The port follows `UNDERCROFT_API_PORT`, the same variable `task dev:api` binds the
    // control plane to, because hardcoding 3000 in both places is only correct while 3000
    // is free. When it is not -- another project's dev server already holds it -- moving
    // the control plane left this proxy pointing at whatever DID answer on 3000, and the
    // symptom is a 404 from `/trpc/session.me` and `/api/auth/sign-in/social` that reads
    // exactly like a broken control plane rather than a misrouted one. Default unchanged.
    proxy: {
      "/trpc": apiOrigin,
      "/oauth": apiOrigin,
      "/api": apiOrigin,
      "/mcp": apiOrigin,
    },
  },
});
