// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noDefaultExport: Three entry points whose default export is the contract: Bun's server object, and Vite's config.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import { readFileSync } from "node:fs";
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
    proxy: {
      "/trpc": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
