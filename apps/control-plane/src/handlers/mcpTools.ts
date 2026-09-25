/**
 * Which tools `/mcp` offers, and what each one says about itself. ADR 0059.
 *
 * The catalogue is the router, described by `procedureManifest()` -- the same walk the CLI bakes
 * into its bundle -- less `MCP_EXCLUDED` and `SESSION_ONLY`. Nothing here is hand-written per
 * procedure, so a procedure added to the router is a tool at the next boot, with the sentence,
 * the effect and the input schema the compiler already made somebody write.
 *
 * - A tool's NAME is its path with `.` as `_`: `bi.questions.save` is `bi_questions_save`.
 * - Its INPUT is the procedure's own JSON Schema, always as an object schema.
 * - Its DESCRIPTION is the procedure's sentence in the caller's language, because a host shows
 *   it to a person (`.claude/rules/i18n.md`).
 * - Its ANNOTATIONS say what the effect says, and nothing the effect cannot back.
 * - Whether it is LISTED turns on the credential's grant (`grantAdmits`), per request.
 */

import type { JSONObject, JSONValue, Tool, ToolAnnotations } from "@modelcontextprotocol/server";
import { procedureManifest } from "./procedures.ts";
import {
  type Effect,
  grantAdmits,
  MCP_EXCLUDED,
  type ProcedureSpec,
  SESSION_ONLY,
} from "./surface.ts";
import type { Context } from "./trpc.ts";

/** A tool's name for a procedure path. See `offered` for why it is one-to-one. */
export function toolName(path: string): string {
  return path.replaceAll(".", "_");
}

/**
 * Every tool a bearer could ever be offered, by name.
 *
 * Refuses a manifest in which two paths would name one tool. The router's segments are
 * camelCase, so `_` never occurs in one today; a path that ever brought one in would make a name
 * mean two procedures, and a call could reach the wrong one. Failing the walk is the cheap way
 * to keep the mapping one-to-one.
 */
function offered(specs: readonly ProcedureSpec[]): ReadonlyMap<string, ProcedureSpec> {
  const byName = new Map<string, ProcedureSpec>();
  for (const spec of specs) {
    if (Object.hasOwn(MCP_EXCLUDED, spec.path) || SESSION_ONLY.includes(spec.path)) {
      continue;
    }
    const name = toolName(spec.path);
    const taken = byName.get(name);
    if (taken !== undefined) {
      throw new Error(`${taken.path} and ${spec.path} would both be the tool ${name}`);
    }
    byName.set(name, spec);
  }
  return byName;
}

/**
 * Built once per process: the router is fixed at boot, so the walk -- which converts every zod
 * input -- is paid once rather than on every request. A walk that throws throws for every
 * request, which is what a router the walk cannot describe honestly deserves.
 */
let catalogue: Promise<ReadonlyMap<string, ProcedureSpec>> | null = null;

function tools(): Promise<ReadonlyMap<string, ProcedureSpec>> {
  catalogue ??= procedureManifest().then(offered);
  return catalogue;
}

/** The procedure a tool name stands for, or `null` for a name no bearer is ever offered. */
export async function toolNamed(name: string): Promise<ProcedureSpec | null> {
  return (await tools()).get(name) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JSONValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JSONObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/**
 * A tool's input as MCP requires it: always an object schema. A procedure that takes nothing
 * has an empty schema in the manifest, which a client would read as "any value".
 *
 * The properties are CHECKED to be plain JSON rather than asserted to be. `asSchema` produces
 * JSON, so this holds for every procedure; a converter that ever put a function or `undefined`
 * in one fails the listing that met it, not a client that tried to parse it.
 */
function inputSchemaOf(spec: ProcedureSpec): Tool["inputSchema"] {
  const { properties = {}, required = [] } = spec.input;
  if (!isJsonObject(properties)) {
    throw new Error(`${spec.path}: an input schema that is not plain JSON cannot be offered`);
  }
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
  };
}

/**
 * What a host may tell its person about a tool before it runs, from the effect alone.
 *
 * `idempotentHint` is never claimed: no procedure promises it, and a host that believed it
 * would retry a `runs.trigger`. `openWorldHint` is left at the protocol's own default.
 */
const ANNOTATIONS: Readonly<Record<Effect, ToolAnnotations>> = {
  read: { readOnlyHint: true },
  write: { readOnlyHint: false, destructiveHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true },
};

/** The tools this caller's credential admits, described in this caller's language. */
export async function listTools(ctx: Context): Promise<Tool[]> {
  return [...(await tools())]
    .filter(([, spec]) => grantAdmits(ctx.grant, spec.effect))
    .map(([name, spec]) => ({
      name,
      description: spec.description[ctx.locale],
      inputSchema: inputSchemaOf(spec),
      annotations: ANNOTATIONS[spec.effect],
    }));
}
