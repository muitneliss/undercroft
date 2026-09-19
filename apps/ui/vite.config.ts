import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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

/** Where `task dev:api` put the control plane. Vite runs in Node, so `process.env` is right here. */
const apiOrigin = `http://localhost:${process.env.UNDERCROFT_API_PORT ?? "3000"}`;

export default defineConfig({
  plugins: [react()],
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
    // Monaco's editor core is one chunk of several megabytes raw, loaded only on the Models
    // route (see `components/SqlEditor.tsx`). Vite's default warns at 500 kB; the warning
    // exists to catch a heavy module riding in the main bundle, which this one does not.
    chunkSizeWarningLimit: 4000,
  },
  server: {
    // The control plane serves /trpc and the OAuth redirects; proxy them in dev.
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
    },
  },
});
