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
 * - whether a door that is not a person's browser should offer it at all (`MCP_EXCLUDED`), and
 *   which procedures only a signed-in browser session may call (`SESSION_ONLY`);
 * - which of the model-context door's two widgets draws its answer (`MCP_WIDGETS`), and the
 *   shape that answer arrives in there (`ToolContentOf`), which the widgets are typed against;
 * - who writes its AUDIT row when it takes effect, if anyone (`AUDITED`, in `audited.ts`, which
 *   is its own module only for length -- ADR 0113);
 * - what a credential's GRANT lets through, given the effect (`grantAdmits`);
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
import type { Grant } from "../services/accessTokens.ts";
import type { AppRouter } from "./router.ts";

export type { Grant } from "../services/accessTokens.ts";
export type { Channel, Outcome } from "../services/audit.ts";
/** What the browser labels an audit row by, and the header the CLI names itself with (ADR 0113). */
export type { AuditAction } from "./audited.ts";
export type { CLI_HEADER } from "./channel.ts";
/**
 * The two OAuth scopes a model-context client asks for (ADR 0061), as TYPES: the consent page
 * in the browser spells them as `typeof READ_SCOPE`, so the two cannot drift.
 */
export type { READ_SCOPE, WRITE_SCOPE } from "../services/connectedApps.ts";
/**
 * What a `/mcp` result carries beyond the procedure's answer, as TYPES a widget spells its reads
 * with (`typeof WIDGET_CALL_META`), each defined beside the one function that writes it.
 */
export type { CLIPPED_NOTES_FIELD } from "./mcpAnswers.ts";
export type { WIDGET_ANSWER_META, WIDGET_CALL_META } from "./mcpWidgets.ts";

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
 * - `write` needs a grant a person gave: the CLI profile's `allowWrites`, or a personal
 *   token minted `write` (ADR 0060).
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
  // A write, not destructive, by the rule this table already keeps: it is undone by
  // `reactivate`, and it deletes nothing. `destructive` is what the CLI confirms as "deletes
  // data and cannot be undone", which would be false here. It still needs a write grant, and
  // the browser asks before it (ADR 0110).
  "tenants.deactivate": "write",
  "tenants.reactivate": "write",

  // `startOAuth` records a handshake and returns a consent URL; the person opens it.
  "connections.startOAuth": "write",
  "connections.setScope": "write",
  "connections.setToken": "write",
  "connections.setCadence": "write",
  "connections.setResync": "write",
  "connections.disconnect": "destructive",

  "keys.mint": "write",
  "keys.revoke": "destructive",

  "people.invite": "write",
  "people.revokeInvitation": "destructive",
  // A role change is undone by another; a removal is undone only by a fresh invitation,
  // which the person has to accept.
  "people.setRole": "write",
  "people.removeMember": "destructive",

  // Saving a role changes what its holders may do, and is undone by saving it back. Deleting one
  // takes every grant to it with it, which nothing restores but granting each again (ADR 0141).
  "roles.save": "write",
  "roles.delete": "destructive",
  // A grant is undone by deleting it; deleting one is undone only by granting it again, with
  // whatever expiry it had looked up first.
  "grants.save": "write",
  "grants.delete": "destructive",

  // Reads nothing it could not read anyway, but it runs SQL an admin wrote against the raw
  // lake, which ADR 0029 kept away from the assistant for the same reason. It takes the same
  // opt-in a write does.
  "lake.query": "write",

  // A POST because a model's SQL does not fit a query string, like `bi.answer`. It reads the
  // tenant's model names and changes nothing, so a read-only credential may use it.
  "models.check": "read",
  "models.save": "write",
  "models.build": "write",
  "models.delete": "destructive",
  // As `lake.query`: author SQL, run as the login that reads the raw lake (ADR 0132).
  "models.preview": "write",

  // As `models.check`: a POST for the text, reading only the tenant's names. Deleting a macro
  // deletes text the customer wrote, like deleting a model (ADR 0086).
  "macros.check": "read",
  "macros.save": "write",
  "macros.delete": "destructive",

  // A seed's table is what the models reading it build from; deleting one drops that table and
  // the cells a person kept, like deleting a model (ADR 0128).
  "seeds.save": "write",
  "seeds.delete": "destructive",

  // Edits change a draft; `publish` is the one that costs, since the worker then classifies every
  // text again (ADR 0085). Removing a kind is undone by adding it back, so it is a write.
  "documentKinds.add": "write",
  "documentKinds.update": "write",
  "documentKinds.remove": "write",
  "documentKinds.publish": "write",
  "documentKinds.initialise": "write",

  // Both are POSTs because a question definition does not fit a query string. They answer a
  // definition the BI role compiles; neither changes anything.
  "bi.answer": "read",
  "bi.runQuestion": "read",
  "bi.questions.save": "write",
  "bi.questions.delete": "destructive",
  "bi.dashboards.save": "write",
  "bi.dashboards.delete": "destructive",
  // A POST for the definition, like `bi.answer`, and a read like it: what it keeps is the
  // asking -- a fifteen-minute row the download finds -- never data. A read grant may export
  // what it may already read (ADR 0111).
  "bi.exports.create": "read",

  "runs.trigger": "write",

  // A credential that mints credentials is a write; taking one away is not undone by
  // anything but minting another, which the person has to go and copy again.
  "account.tokens.mint": "write",
  "account.tokens.revoke": "destructive",
  // Undone only by the person signing the app in again and consenting afresh.
  "account.apps.revoke": "destructive",
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

/**
 * Whether a credential holding `grant` may make a call whose effect is `effect`.
 *
 * The one statement of the read/write policy, asked by the router's own middleware (`trpc.ts`,
 * the door every caller goes through) and by the model-context door when it decides which
 * tools to list. A `read` grant admits only what is classified `read`, so an unclassified path
 * -- `null` -- is refused: the guard fails closed. A `write` grant admits everything the role
 * gates admit; it is what a person's own browser session always holds.
 */
export function grantAdmits(grant: Grant, effect: Effect | null): boolean {
  return grant === "write" || effect === "read";
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
  "config.signIn":
    "which ways in the sign-in page offers; a client already holding a credential is past it",
};

/**
 * The procedures only a person's own browser session may call: never a bearer credential.
 *
 * They manage credentials. A token that could reach them could mint a token, and a READ token
 * could mint itself a WRITE one -- so the grant a person chose would bind nothing. The router
 * enforces it (`sessionProcedure` in `trpc.ts`); this list is what a door that only ever holds
 * a bearer reads to leave them out, and `procedureManifest` refuses to describe a router whose
 * `sessionProcedure` and this list disagree, so the two cannot drift apart. A stale path is a
 * `tsc` error. The CLI keeps them: it signs in with the same session cookie the browser does.
 */
export const SESSION_ONLY: readonly ProcedurePath[] = [
  "account.tokens.list",
  "account.tokens.mint",
  "account.tokens.revoke",
  "account.apps.list",
  "account.apps.revoke",
];

/**
 * The model-context door's widgets (ADR 0061): small pages a host that speaks MCP Apps draws
 * beside a tool's answer. `apps/mcp-widgets` holds their source.
 *
 * - `grid` prints a result as a table, cell for cell the way the web UI's `ResultTable` does.
 * - `run` follows one run until it ends, asking `runs.get` and `runs.events` itself.
 */
export type WidgetId = "grid" | "run";

/**
 * Which procedure's answer each widget draws. A procedure not named here is answered in text and
 * structured content only, which is what every host gets anyway.
 *
 * `as const` so the widgets can be typed against it (`WidgetPaths`): a path added here fails the
 * widget's `tsc` until it can draw it, and a stale one fails here.
 */
export const MCP_WIDGETS = {
  "lake.query": "grid",
  "lake.search": "grid",
  "lake.records": "grid",
  "lake.documents": "grid",
  "models.preview": "grid",
  "bi.answer": "grid",
  "bi.runQuestion": "grid",
  "bi.questions.answer": "grid",
  "runs.trigger": "run",
  "runs.get": "run",
} as const satisfies WidgetTable;

export type WidgetTable = Readonly<Partial<Record<ProcedurePath, WidgetId>>>;

/** The paths whose answer the widget `W` draws. */
export type WidgetPaths<W extends WidgetId> = {
  [P in keyof typeof MCP_WIDGETS]: (typeof MCP_WIDGETS)[P] extends W ? P : never;
}[keyof typeof MCP_WIDGETS];

/**
 * The procedures a widget asks for itself, through the host (`app.callServerTool`), and which
 * widget asks. The run widget polls the run and its feed (`runStatus.ts`). A widget may call only
 * a path named here -- its tool names are typed against this table -- because a widget reads its
 * answer whole from `_meta` (`WIDGET_ANSWER_META`), and the door puts it there only for a path
 * some widget reads.
 */
export const WIDGET_READS = {
  "runs.get": "run",
  "runs.events": "run",
} as const satisfies WidgetTable;

/**
 * What a procedure's answer is as a tool's content: the wire form (`OutputOf`), and because
 * structured content must be an object, a list as `{ items }` and anything else that is not an
 * object as `{ value }`. `mcpAnswers.ts` does this at run time; this is the same rule for the
 * compiler, so a widget reading `items` breaks when a procedure stops answering a list. It is the
 * shape of the whole answer in `_meta` (`WIDGET_ANSWER_META`) and of `structuredContent`, whose
 * top-level lists may be clipped.
 */
export type ToolContentOf<P extends ProcedurePath> =
  OutputOf<P> extends readonly unknown[]
    ? { readonly items: OutputOf<P> }
    : OutputOf<P> extends object
      ? OutputOf<P>
      : { readonly value: OutputOf<P> };

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
 * `PRECONDITION_REQUIRED` sits beside `PRECONDITION_FAILED` for the same reason, and
 * `PAYMENT_REQUIRED` is a refusal of this caller's access, so it reads as PERMISSION_DENIED.
 */
export type ErrorCodeTable = Readonly<Record<TRPC_ERROR_CODE_KEY, SurfaceErrorCode>>;

export const BY_TRPC_CODE: ErrorCodeTable = {
  UNAUTHORIZED: "AUTHENTICATION_REQUIRED",
  FORBIDDEN: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "CONFLICT",
  PRECONDITION_REQUIRED: "CONFLICT",
  PAYMENT_REQUIRED: "PERMISSION_DENIED",
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

export type { JsonSchema, ProcedureSpec } from "./procedureSpec.ts";
