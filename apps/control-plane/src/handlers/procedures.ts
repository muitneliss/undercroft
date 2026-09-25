/**
 * The router at run time: which procedures exist, how to reach one by its dotted path, and
 * the description every caller outside the browser is built from.
 *
 * `surface.ts` holds what the compiler knows about the router and the facts a person wrote
 * about each procedure; this is the other half, the part that needs the router as a VALUE.
 * They are separate so that the router's own middleware can read `surface.ts` without a cycle.
 *
 * Three callers share it. The assistant resolves its catalogue's paths to callables here. The
 * CLI's build calls `procedureManifest()` and bakes the answer into its bundle as data, which
 * is how a bundle holding no router code still has one command per procedure (ADR 0044). A
 * model-context door lists the same manifest as tools. One walk, so the three cannot disagree
 * about what the platform can do.
 */

import { asSchema } from "ai";
import { ZodType } from "zod";
import { procedureSentences as en } from "../i18n/procedures.en.ts";
import { procedureSentences as vi } from "../i18n/procedures.vi.ts";
import { appRouter } from "./router.ts";
import {
  effectOf,
  type JsonSchema,
  type ProcedurePath,
  type ProcedureSpec,
  SESSION_ONLY,
} from "./surface.ts";
import { sessionProcedure, tenantProcedure } from "./trpc.ts";

export type Caller = ReturnType<typeof appRouter.createCaller>;

/**
 * Every procedure the router actually has, by dotted path.
 *
 * Read from the router's own definition rather than probed on a caller, and that distinction
 * cost a debugging round worth recording: `createCaller` returns a PROXY, so `"list" in caller.tenants`
 * is false for a procedure that exists, and `Reflect.get` returns a truthy proxy for one that
 * does not. Neither can answer "does this exist" -- only `_def.procedures` can.
 */
export const PROCEDURE_PATHS: ReadonlySet<string> = new Set(Object.keys(appRouter._def.procedures));

/**
 * Whether a string names a procedure the router has: the run-time half of `ProcedurePath`,
 * which is derived from the same router and so names the same set.
 */
function isProcedurePath(path: string): path is ProcedurePath {
  return PROCEDURE_PATHS.has(path);
}

type Procedure = (input: unknown) => Promise<unknown>;

/**
 * A type PREDICATE, not an assertion.
 *
 * The difference matters at this particular boundary: what comes back from walking a proxy is
 * genuinely unknown, and `as Procedure` would be a promise about it that nothing checked.
 * Narrowing instead means the callable is checked once, here, and a path that resolved to
 * something else is a refusal rather than a call into a non-function.
 */
function isProcedure(value: unknown): value is Procedure {
  return typeof value === "function";
}

/**
 * The callable a dotted path names on a caller, or `null` when the router has no such path.
 *
 * Existence is decided by `PROCEDURE_PATHS` first -- see above for why the proxy cannot
 * answer it -- and only then is the proxy descended, which is what it is good at.
 */
export function resolveProcedure(caller: Caller, path: string): Procedure | null {
  if (!PROCEDURE_PATHS.has(path)) {
    return null;
  }
  let node: unknown = caller;
  for (const segment of path.split(".")) {
    // `function` as well as `object`, and that is not defensive padding: tRPC builds the caller
    // from a RECURSIVE CALLABLE proxy, so `caller.tenants` is itself a function rather than a
    // plain object. Descending only through `object` rejected every nested procedure while
    // `PROCEDURE_PATHS` said it existed -- which reads exactly like a catalogue typo.
    if (node === null || (typeof node !== "object" && typeof node !== "function")) {
      return null;
    }
    node = Reflect.get(node, segment);
  }
  return isProcedure(node) ? node : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A procedure's `_def`, read by name: tRPC types it on a builder but not on the result. */
function defOf(procedure: unknown): unknown {
  return isRecord(procedure) || typeof procedure === "function"
    ? Reflect.get(procedure, "_def")
    : null;
}

/**
 * A procedure's chained input parsers.
 *
 * Present at run time on every finished procedure; a missing one is a tRPC upgrade this walk
 * should fail on rather than read as "no input".
 */
function inputsOf(path: string, procedure: unknown): readonly unknown[] {
  const def = defOf(procedure);
  const inputs: unknown = isRecord(def) ? def.inputs : undefined;
  if (!Array.isArray(inputs)) {
    throw new Error(`${path}: the procedure has no _def.inputs; has tRPC changed shape?`);
  }
  return inputs;
}

/** A procedure's middleware chain, outermost first. Missing is a tRPC upgrade, as above. */
function middlewaresOf(path: string, procedure: unknown): readonly unknown[] {
  const def = defOf(procedure);
  const middlewares: unknown = isRecord(def) ? def.middlewares : undefined;
  if (!Array.isArray(middlewares)) {
    throw new Error(`${path}: the procedure has no _def.middlewares; has tRPC changed shape?`);
  }
  return middlewares;
}

/**
 * The one middleware `sessionProcedure` adds, by identity -- how `tenantScoped` is read below,
 * for the same reason: a procedure built on it carries that very function in its chain.
 */
const SESSION_GUARD: unknown = sessionProcedure._def.middlewares.at(-1);

/**
 * Whether the router's `sessionProcedure` and `SESSION_ONLY` agree about `path`.
 *
 * Two statements of one fact -- the middleware that refuses a bearer, and the list a bearer-only
 * door reads to leave the procedure out -- so the walk refuses a router where they differ. A
 * session-only procedure missing from the list would be offered as a tool that always refuses;
 * a listed one the middleware does not guard would be hidden from a door that could call it.
 */
function assertSessionOnlyAgrees(path: ProcedurePath, procedure: unknown): void {
  const guarded = middlewaresOf(path, procedure).includes(SESSION_GUARD);
  if (guarded !== SESSION_ONLY.includes(path)) {
    throw new Error(
      `${path}: sessionProcedure and SESSION_ONLY in handlers/surface.ts disagree about it`,
    );
  }
}

/** A subscription is refused: no caller built from this manifest has a way to serve one. */
function typeOf(path: string, procedure: unknown): "query" | "mutation" {
  const def = defOf(procedure);
  const type: unknown = isRecord(def) ? def.type : undefined;
  if (type !== "query" && type !== "mutation") {
    throw new Error(`${path}: a ${String(type)} cannot be served as a one-shot call`);
  }
  return type;
}

/**
 * The procedure's own zod input, converted by `asSchema` from `ai` -- the same conversion the
 * assistant's tools go through -- so there is no second description of any input to fall out
 * of step with the first.
 */
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

/**
 * tRPC merges chained object inputs key by key at run time; so does this. A procedure built on
 * `tenantProcedure` has a chain -- `{ tenantId }`, then its own.
 */
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

/**
 * The router, described: every procedure's path, type, merged input, tenant scope, effect and
 * sentences, sorted by path.
 *
 * Throws, naming the procedure, on anything it cannot describe honestly. The tables it joins
 * are typed against the router, so their gaps are `tsc` errors before this ever runs; what is
 * left to refuse here is what only the running router shows -- a subscription, an input that
 * is not zod, a chain that cannot be merged, a session-only procedure `SESSION_ONLY` misses.
 */
export async function procedureManifest(): Promise<ProcedureSpec[]> {
  const [tenantInput] = tenantProcedure._def.inputs;
  const specs: ProcedureSpec[] = [];
  for (const [path, procedure] of Object.entries(appRouter._def.procedures)) {
    if (!isProcedurePath(path)) {
      throw new Error(`${path}: not a procedure path; has tRPC changed shape?`);
    }
    assertSessionOnlyAgrees(path, procedure);
    const inputs = inputsOf(path, procedure);
    const schemas = await Promise.all(inputs.map((parser) => jsonSchemaOf(path, parser)));
    const type = typeOf(path, procedure);
    const effect = effectOf({ path, type });
    if (effect === null) {
      throw new Error(`${path}: a mutation with no effect in handlers/surface.ts`);
    }
    specs.push({
      path,
      type,
      input: mergeObjects(path, schemas),
      // Identity, not shape: the one parser object `tenantProcedure` puts first in every
      // chain built on it. `tenants.create` also takes a `tenantId`, and is not scoped.
      tenantScoped: inputs[0] !== undefined && inputs[0] === tenantInput,
      effect,
      description: { vi: vi[path], en: en[path] },
    });
  }
  return specs.sort((a, b) => a.path.localeCompare(b.path));
}
