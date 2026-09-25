/**
 * Every hand-written fact about a procedure, beside the router and typed against it.
 *
 * The router is the source of truth for what the platform can do: every caller outside the
 * browser -- the CLI (ADR 0044), the assistant (ADR 0029), and any later door -- is built from
 * it rather than from a list of its own. A few facts about a procedure cannot be read off it,
 * though, and those are here:
 *
 * - its EFFECT, because tRPC's query/mutation split is about HTTP and not about consequences
 *   (`EFFECTS`);
 * - its SENTENCE in each language (`../i18n/procedures.{vi,en}.ts`);
 * - whether a door that is not a person's browser should offer it at all (`MCP_EXCLUDED`);
 * - what a refusal means to a caller that is not tRPC's own client (`BY_TRPC_CODE`).
 *
 * Every table is typed against `AppRouter` itself, so a router change becomes a `tsc` error
 * rather than a stale entry found at run time: a new mutation with no effect, a procedure
 * with no sentence, a renamed or deleted procedure still named anywhere, or a tRPC error code
 * nobody mapped. `surface.typecheck.ts` pins that each of those refusals still bites.
 *
 * ## Why this module never imports the router by value
 *
 * Only `import type`. The router's middleware (`trpc.ts`) is going to ask `effectOf` whether
 * a call may go through, and `router.ts` imports `trpc.ts`; a value import of the router here
 * would close that into a cycle that leaves one of them half-evaluated. What this module
 * knows about the router it knows from the compiler. The run-time walk of the router -- which
 * procedures exist, their input schemas, how to call one by path -- is `procedures.ts`.
 */

import type {
  AnyTRPCProcedure,
  inferRouterInputs,
  inferRouterOutputs,
  TRPCProcedureType,
} from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import type { Locale } from "@undercroft/core/locale";
import type { AppRouter } from "./router.ts";

type RouterRecord = AppRouter["_def"]["record"];

/** The dotted paths under `record` whose procedure is of a `type` in `Kind`. */
type PathsOf<Record, Kind extends TRPCProcedureType, Prefix extends string = ""> = {
  [Key in keyof Record & string]: Record[Key] extends AnyTRPCProcedure
    ? Record[Key]["_def"]["type"] extends Kind
      ? `${Prefix}${Key}`
      : never
    : PathsOf<Record[Key], Kind, `${Prefix}${Key}.`>;
}[keyof Record & string];

/** Every procedure the router has, by dotted path: `"bi.questions.save" | "runs.get" | …`. */
export type ProcedurePath = PathsOf<RouterRecord, TRPCProcedureType>;
export type MutationPath = PathsOf<RouterRecord, "mutation">;
export type QueryPath = PathsOf<RouterRecord, "query">;

/** How a path is sent over the wire: a query is a GET, a mutation a POST. */
export type KindOf<P extends ProcedurePath> = P extends MutationPath ? "mutation" : "query";

/** The value at a dotted path in a nested record. */
type AtPath<Tree, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Tree
    ? AtPath<Tree[Head], Rest>
    : never
  : Path extends keyof Tree
    ? Tree[Path]
    : never;

/** What a procedure takes, as tRPC infers it from the zod input. */
export type InputOf<P extends ProcedurePath> = AtPath<inferRouterInputs<AppRouter>, P>;

/** What a procedure answers, as it arrives over the wire (JSON, no transformer). */
export type OutputOf<P extends ProcedurePath> = AtPath<inferRouterOutputs<AppRouter>, P>;

/**
 * What a procedure does to the platform, which is what a caller's safety rules turn on.
 *
 * - `read` goes through on any grant.
 * - `write` needs a grant a person gave: the CLI profile's `allowWrites`.
 * - `destructive` needs that AND, where nobody can be asked, an explicit confirmation.
 */
export type Effect = "read" | "write" | "destructive";

/**
 * Every mutation MUST be classified; a query MAY be, and is `read` if it is not.
 *
 * Total over mutations because a new mutation shipping as a read by default is the failure
 * that would matter: it would reach a read-only grant unguarded.
 */
export type EffectTable = Readonly<
  Record<MutationPath, Effect> & Partial<Record<QueryPath, Effect>>
>;

/**
 * The one table tRPC's shape cannot answer. A mutation is a POST, not a promise to change
 * anything: `bi.answer` is a mutation that reads, and deleting a dashboard is a mutation too.
 */
export const EFFECTS: EffectTable = {
  // Signing out can only take authority away, and gating it would leave a person unable to
  // end a session on the very profile that forbids writes.
  "session.signOut": "read",
  "session.setLocale": "write",

  "tenants.create": "write",
  "tenants.rename": "write",

  // `startOAuth` records a handshake and returns a consent URL; the person opens it.
  "connections.startOAuth": "write",
  "connections.setScope": "write",
  "connections.setToken": "write",
  "connections.setCadence": "write",
  "connections.disconnect": "destructive",

  "keys.mint": "write",
  "keys.revoke": "destructive",

  "people.invite": "write",
  "people.revokeInvitation": "destructive",
  // A role change is undone by another; a removal is undone only by a fresh invitation,
  // which the person has to accept.
  "people.setRole": "write",
  "people.removeMember": "destructive",

  // Reads nothing it could not read anyway, but it runs SQL an admin wrote against the raw
  // lake, which ADR 0029 kept away from the assistant for the same reason. It takes the same
  // opt-in a write does.
  "lake.query": "write",

  "models.save": "write",
  "models.build": "write",
  "models.delete": "destructive",

  // Both are POSTs because a question definition does not fit a query string. They answer a
  // definition the BI role compiles; neither changes anything.
  "bi.answer": "read",
  "bi.runQuestion": "read",
  "bi.questions.save": "write",
  "bi.questions.delete": "destructive",
  "bi.dashboards.save": "write",
  "bi.dashboards.delete": "destructive",

  "runs.trigger": "write",
};

const LISTED: ReadonlyMap<string, Effect> = new Map(Object.entries(EFFECTS));

/**
 * A procedure's effect, or `null` for a mutation nobody classified.
 *
 * Takes a plain string because its callers hold one: tRPC's middleware sees the path of the
 * call in flight, and the router walk sees the keys of `_def.procedures`. For a real path the
 * type of `EFFECTS` makes `null` unreachable; a caller deciding whether to let a call through
 * treats it as "no", so an unclassified path fails closed rather than open.
 */
export function effectOf(procedure: {
  readonly path: string;
  readonly type: TRPCProcedureType;
}): Effect | null {
  return LISTED.get(procedure.path) ?? (procedure.type === "query" ? "read" : null);
}

/** One sentence per procedure, per language. The router decides which keys exist. */
export type SentenceTable = Readonly<Record<ProcedurePath, string>>;

/**
 * The procedures a model-context client is not offered, each with why.
 *
 * Everything else the router has is a tool. A reason is required so that "excluded" is a
 * decision somebody wrote down rather than an omission, and a stale path is a `tsc` error.
 */
export type ExclusionTable = Readonly<Partial<Record<ProcedurePath, string>>>;

export const MCP_EXCLUDED: ExclusionTable = {
  "session.signOut":
    "ends a cookie session; a bearer credential has none, and is revoked where it was minted",
  health: "a liveness probe for the load balancer; it says nothing about the caller's data",
  "config.google":
    "the public halves of the Google client, for the browser's Drive picker and nothing else",
};

/**
 * What a refusal means to a caller, independent of tRPC's wording.
 *
 * The CLI's envelope carries these codes, and so will every other door that is not tRPC's own
 * client. They are the codes an agent programs against, so each says what the CALLER can do
 * about it rather than what went wrong inside.
 */
export type SurfaceErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR";

/**
 * tRPC's error codes, as the surface's. Total, so a code tRPC adds must be mapped before the
 * build passes.
 *
 * `PRECONDITION_FAILED` is the router's "the worker did not answer" and "no rows stored": the
 * request was fine and the platform's state refused it, which is what CONFLICT means to a
 * caller. The server's own sentence says which, and is passed through. The server-side
 * failures all read as INTERNAL_ERROR: the caller cannot tell them apart and cannot fix any.
 */
export type ErrorCodeTable = Readonly<Record<TRPC_ERROR_CODE_KEY, SurfaceErrorCode>>;

export const BY_TRPC_CODE: ErrorCodeTable = {
  UNAUTHORIZED: "AUTHENTICATION_REQUIRED",
  FORBIDDEN: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "CONFLICT",
  BAD_REQUEST: "VALIDATION_FAILED",
  PARSE_ERROR: "VALIDATION_FAILED",
  PAYLOAD_TOO_LARGE: "VALIDATION_FAILED",
  UNPROCESSABLE_CONTENT: "VALIDATION_FAILED",
  UNSUPPORTED_MEDIA_TYPE: "INTERNAL_ERROR",
  METHOD_NOT_SUPPORTED: "INTERNAL_ERROR",
  TIMEOUT: "TIMEOUT",
  TOO_MANY_REQUESTS: "NETWORK_ERROR",
  CLIENT_CLOSED_REQUEST: "INTERNAL_ERROR",
  INTERNAL_SERVER_ERROR: "INTERNAL_ERROR",
  NOT_IMPLEMENTED: "INTERNAL_ERROR",
  BAD_GATEWAY: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "INTERNAL_ERROR",
  GATEWAY_TIMEOUT: "INTERNAL_ERROR",
};

/** A JSON Schema, as far as a caller reads one. Everything else in it is passed through. */
export interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly default?: unknown;
  readonly anyOf?: readonly JsonSchema[];
}

/**
 * One procedure, described: the router's own facts joined with the tables above.
 *
 * Plain data, so it can be baked into a bundle that holds no router code (the CLI) or served
 * to a client that has never seen TypeScript.
 */
export interface ProcedureSpec {
  /** The router's dotted path, e.g. `bi.questions.save`. */
  readonly path: ProcedurePath;
  readonly type: "query" | "mutation";
  /** The merged input of the procedure's whole chain, `tenantProcedure`'s `tenantId` included. */
  readonly input: JsonSchema;
  /**
   * Whether the procedure is scoped to a tenant the caller already holds authority in.
   *
   * What lets a caller offer the tenants it can see: `runs.list` wants one of them,
   * `tenants.create` wants a NEW id, and both call the field `tenantId`.
   */
  readonly tenantScoped: boolean;
  readonly effect: Effect;
  /** What the procedure does, in each language, from `../i18n/procedures.{vi,en}.ts`. */
  readonly description: Readonly<Record<Locale, string>>;
}
