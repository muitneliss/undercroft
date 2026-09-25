/**
 * Build the CLI: one Node ES module with a shebang, the platform's surface baked in.
 *
 * The one owner of the build, and the only place the CLI's source meets the control plane by
 * value. It runs at BUILD time, under Bun, and it may call the control plane's
 * `procedureManifest()` for exactly that reason: what it takes is data -- each procedure's
 * path, type, input JSON Schema, effect and sentences, and the map from a tRPC error code to
 * the CLI's -- and what it ships is a bundle that holds no router code at all. At RUN time the
 * CLI reaches the platform only over HTTP (`.ast-grep/rules/cli-boundary.yml`, ADR 0044).
 *
 * Almost everything that could make the surface dishonest is a `tsc` error before this runs:
 * the effect and sentence tables and the CLI's topic sentences are typed against the router
 * (`apps/control-plane/src/handlers/surface.ts`). The walk refuses what only the running router
 * shows, such as a subscription. What is left for this file is the one thing that is the CLI's
 * alone: an input property whose flag would collide with a global flag.
 *
 * Also runnable: `task build:cli` writes `apps/cli/dist/undercroft.mjs`.
 */

import { chmodSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { procedureManifest } from "@undercroft/control-plane/procedures";
import { BY_TRPC_CODE } from "@undercroft/control-plane/surface";
import { reservedFlags } from "../src/flags.ts";
import { messages } from "../src/i18n/index.ts";
import type { ProcedureSpec } from "../src/manifest.ts";
import { flagSpecs } from "../src/services/input.ts";

export const BUNDLE = "undercroft.mjs";

/** The specifier `src/commands.ts` imports, and everything in the namespace it resolves to. */
const VIRTUAL_SPECIFIER = /^virtual:surface$/u;
const ANY_PATH = /.*/u;

/**
 * Every input property whose flag would shadow a global one, as sentences. Empty is the only
 * pass. A property is the router's and a global flag the CLI's, so neither side's types know
 * about the other and only the built manifest can be checked.
 */
export function surfaceProblems(specs: readonly ProcedureSpec[]): string[] {
  const reserved = reservedFlags(messages("vi"));
  return specs.flatMap((spec) =>
    flagSpecs(spec.input)
      .filter((flag) => reserved.has(flag.flag))
      .map((flag) => `${spec.path}: input property ${flag.property} collides with --${flag.flag}`),
  );
}

/** Build the bundle into `outdir` and answer with its path. */
export async function buildCli(outdir: string): Promise<string> {
  const specs = await procedureManifest();
  const problems = surfaceProblems(specs);
  if (problems.length > 0) {
    throw new Error(`the CLI cannot be built:\n  ${problems.join("\n  ")}`);
  }
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", "src", "main.ts")],
    outdir,
    naming: BUNDLE,
    target: "node",
    format: "esm",
    banner: "#!/usr/bin/env node",
    // oclif can transpile a TypeScript plugin at run time and so `require`s the compiler --
    // lazily, and never once `main.ts` sets `enableAutoTranspile` off. Bundled, it was 9 MB
    // of the 10.
    external: ["typescript", "ts-node", "tsx"],
    // Bun inlines `process.env.NODE_ENV`, and left alone it inlined "development" -- so the
    // shipped CLI believed it was always in development, and oclif printed its development
    // warnings (`[UnparsedCommand]` after a refused flag) into the stderr agent mode promises
    // is empty. What ships is production, whatever the user's own shell says.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      {
        name: "virtual:surface",
        setup(build): void {
          build.onResolve({ filter: VIRTUAL_SPECIFIER }, () => ({
            path: "surface",
            namespace: "virtual",
          }));
          build.onLoad({ filter: ANY_PATH, namespace: "virtual" }, () => ({
            contents: [
              `export const PROCEDURES = ${JSON.stringify(specs)};`,
              `export const BY_TRPC_CODE = ${JSON.stringify(BY_TRPC_CODE)};`,
            ].join("\n"),
            loader: "js",
          }));
        },
      },
    ],
  });
  if (!result.success) {
    throw new Error(`Bun.build failed:\n${result.logs.map(String).join("\n")}`);
  }
  const bundle = join(outdir, BUNDLE);
  chmodSync(bundle, 0o755);
  return bundle;
}

if (import.meta.main) {
  const bundle = await buildCli(join(import.meta.dir, "..", "dist"));
  process.stdout.write(`${bundle}\n`);
}
