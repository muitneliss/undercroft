/**
 * Build the CLI: one Node ES module with a shebang, the router's manifest baked in.
 *
 * The one owner of the build, and the only place the CLI's source meets the router. It runs
 * at BUILD time, under Bun, and it may import `appRouter` for exactly that reason: what it
 * takes from the router is data -- each procedure's path, type and input JSON Schema -- and
 * what it ships is a bundle that holds no router code at all. At RUN time the CLI reaches the
 * platform only over HTTP (`.ast-grep/rules/cli-boundary.yml`, ADR 0044).
 *
 * The schemas are the router's own zod inputs, converted by `asSchema` from `ai` -- the same
 * conversion the assistant's tools go through -- so there is no second description of any
 * input to fall out of step. A procedure built on `tenantProcedure` has a CHAIN of inputs
 * (`{ tenantId }`, then its own), which tRPC merges at run time; they are merged here the same
 * way.
 *
 * The build refuses, loudly, a surface it cannot ship honestly:
 * - a mutation `src/procedures.ts` does not classify, or a classification naming a path the
 *   router does not have;
 * - a procedure, or a topic its path implies, with no sentence in either catalogue;
 * - an input property whose flag would collide with a global flag;
 * - a subscription, which a one-shot CLI has no way to serve.
 *
 * Also runnable: `task build:cli` writes `apps/cli/dist/undercroft.mjs`.
 */

import { chmodSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { tenantProcedure } from "@undercroft/control-plane/trpc";
import { appRouter } from "@undercroft/control-plane/router";
import { asSchema } from "ai";
import { ZodType } from "zod";
import { reservedFlags } from "../src/flags.ts";
import { messages, procedureSentence, topicSentence } from "../src/i18n/index.ts";
import {
  commandId,
  type JsonSchema,
  type ProcedureSpec,
  spoken,
  topicsOf,
} from "../src/manifest.ts";
import { EFFECTS, effectOf } from "../src/procedures.ts";
import { flagSpecs } from "../src/services/input.ts";

export const BUNDLE = "undercroft.mjs";

/** The specifier `src/commands.ts` imports, and everything in the namespace it resolves to. */
const VIRTUAL_SPECIFIER = /^virtual:procedures$/u;
const ANY_PATH = /.*/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A procedure's chained input parsers.
 *
 * Read by name rather than through tRPC's types, which describe `_def.inputs` on a builder
 * but not on the finished procedure -- it is there at run time, and a missing one is a tRPC
 * upgrade this build should fail on rather than read as "no input".
 */
function inputsOf(path: string, procedure: unknown): readonly unknown[] {
  const def: unknown =
    isRecord(procedure) || typeof procedure === "function" ? Reflect.get(procedure, "_def") : null;
  const inputs: unknown = isRecord(def) ? def.inputs : undefined;
  if (!Array.isArray(inputs)) {
    throw new Error(`${path}: the procedure has no _def.inputs; has tRPC changed shape?`);
  }
  return inputs;
}

function typeOf(path: string, procedure: unknown): "query" | "mutation" {
  const def: unknown =
    isRecord(procedure) || typeof procedure === "function" ? Reflect.get(procedure, "_def") : null;
  const type: unknown = isRecord(def) ? def.type : undefined;
  if (type !== "query" && type !== "mutation") {
    throw new Error(`${path}: a ${String(type)} cannot be served by a one-shot CLI`);
  }
  return type;
}

async function jsonSchemaOf(path: string, parser: unknown): Promise<JsonSchema> {
  if (!(parser instanceof ZodType)) {
    throw new Error(`${path}: an input that is not a zod schema cannot be described`);
  }
  const schema: unknown = await asSchema(parser).jsonSchema;
  if (!isRecord(schema)) {
    throw new Error(`${path}: asSchema produced no JSON Schema`);
  }
  return schema;
}

/** tRPC merges chained object inputs key by key; so does this. */
function mergeObjects(path: string, schemas: readonly JsonSchema[]): JsonSchema {
  if (schemas.length === 0) {
    return {};
  }
  const properties: Record<string, JsonSchema> = {};
  const required = new Set<string>();
  for (const schema of schemas) {
    if (schema.type !== "object") {
      throw new Error(`${path}: a chained input that is not an object cannot be merged`);
    }
    Object.assign(properties, schema.properties ?? {});
    for (const name of schema.required ?? []) {
      required.add(name);
    }
  }
  return { type: "object", properties, required: [...required] };
}

/** The router, described: every procedure's path, type, merged input and tenant scope. */
export async function procedureManifest(): Promise<ProcedureSpec[]> {
  const [tenantInput] = tenantProcedure._def.inputs;
  const specs: ProcedureSpec[] = [];
  for (const [path, procedure] of Object.entries(appRouter._def.procedures)) {
    const inputs = inputsOf(path, procedure);
    const schemas = await Promise.all(inputs.map((parser) => jsonSchemaOf(path, parser)));
    specs.push({
      path,
      type: typeOf(path, procedure),
      input: mergeObjects(path, schemas),
      // Identity, not shape: the one parser object `tenantProcedure` puts first in every
      // chain built on it. `tenants.create` also takes a `tenantId`, and is not scoped.
      tenantScoped: inputs[0] !== undefined && inputs[0] === tenantInput,
    });
  }
  return specs.sort((a, b) => a.path.localeCompare(b.path));
}

/** Everything the CLI would ship dishonestly, as one list of sentences. Empty is the only pass. */
export function surfaceProblems(specs: readonly ProcedureSpec[]): string[] {
  const paths = new Set(specs.map((spec) => spec.path));
  const reserved = reservedFlags(messages("vi"));
  return [
    ...specs
      .filter((spec) => effectOf(spec) === null)
      .map((spec) => `${spec.path}: a mutation with no effect in src/procedures.ts`),
    ...Object.keys(EFFECTS)
      .filter((path) => !paths.has(path))
      .map((path) => `${path}: classified in src/procedures.ts but not in the router`),
    ...specs.flatMap((spec) =>
      (["vi", "en"] as const)
        .filter((locale) => procedureSentence(locale, spec.path) === null)
        .map((locale) => `${spec.path}: no sentence in src/i18n/${locale}.ts`),
    ),
    ...topicsOf(specs.map((spec) => commandId(spec.path))).flatMap((topic) =>
      (["vi", "en"] as const)
        .filter((locale) => topicSentence(locale, topic) === null)
        .map((locale) => `topic ${spoken(topic)}: no sentence in src/i18n/${locale}.ts topics`),
    ),
    ...specs.flatMap((spec) =>
      flagSpecs(spec.input)
        .filter((flag) => reserved.has(flag.flag))
        .map(
          (flag) => `${spec.path}: input property ${flag.property} collides with --${flag.flag}`,
        ),
    ),
  ];
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
        name: "virtual:procedures",
        setup(build): void {
          build.onResolve({ filter: VIRTUAL_SPECIFIER }, () => ({
            path: "procedures",
            namespace: "virtual",
          }));
          build.onLoad({ filter: ANY_PATH, namespace: "virtual" }, () => ({
            contents: `export const PROCEDURES = ${JSON.stringify(specs)};`,
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
