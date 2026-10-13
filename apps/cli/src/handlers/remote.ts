/**
 * The CLI's only way into the platform: HTTP to the same `/trpc` and `/api/auth` the web UI
 * calls, carrying the person's own Better Auth session cookie -- or, signed in unattended, their
 * own personal access token as `Authorization: Bearer` (ADR 0134).
 *
 * That is the whole reason the CLI is not a backdoor. Every procedure answers here exactly as
 * it answers the browser -- `tenantProcedure`'s authority check, `requireRole`, the
 * 404-not-403 boundary and the localized refusals all run on the server, and none of them is
 * re-implemented or bypassed; a token adds only its grant, which the server enforces too. There
 * is no DSN, no service token and no second auth path. `.ast-grep/rules/cli-boundary.yml`
 * keeps it that way.
 *
 * Signing in, which is Better Auth's `/api/auth` rather than tRPC, is `authEndpoints.ts`; this
 * module owns the connection, the tRPC wire and what counts as unreachable, which both share.
 *
 * ## Why tRPC's wire is spoken here rather than through `@trpc/client`
 *
 * `@trpc/client` and `@trpc/server` are released in lockstep: every client version declares
 * an EXACT peer on the same server version, and imports run-time helpers from it. The repo's
 * server is 11.0.0, the rule for a new dependency is its latest version (11.19.0 when this was
 * written), and 11.19.0 cannot even be bundled against 11.0.0 -- it imports
 * `retryableRpcCodes` and `getTRPCErrorShape`, which 11.0.0 does not export. Bumping the
 * server is a change of its own. So the CLI speaks the protocol directly, which for one
 * non-batched call with no transformer is small:
 *
 *   query     GET  /trpc/<path>?input=<encodeURIComponent(JSON)>   (no `input` when none)
 *   mutation  POST /trpc/<path>, the input as the JSON body          (no body when none)
 *   answer    { result: { data } }  or  { error: { message, code, data: { code, httpStatus } } }
 *
 * The contract is the server's fetch adapter in `@trpc/server` 11.0.0 --
 * `unstable-core-do-not-import/http/contentType` reads the request, `resolveResponse` writes
 * the answer -- and this mirrors what `@trpc/client` 11.0.0's `httpLink` sends (`httpUtils`
 * `getUrl`/`getBody`), content type included. `cli.test.ts` proves it against the real server.
 * When the repo upgrades tRPC, this can go back to `createTRPCUntypedClient` (ADR 0044).
 *
 * Not batched: one command is one call, and a batch would fold a refusal of one procedure
 * into the response of another.
 */

import type { CLI_HEADER } from "@undercroft/control-plane/surface";
import type { Locale } from "@undercroft/core/locale";
import { BY_TRPC_CODE } from "virtual:surface";
import type { Translate } from "../i18n/index.ts";
import type {
  InputOf,
  KindOf,
  ProcedurePath,
  ProcedureSpec,
  SurfaceErrorCode,
} from "../manifest.ts";
import type { Presented } from "../services/credentials.ts";
import { failure, type Outcome, type Refusal, success } from "../services/output.ts";

/**
 * How long one request may take. Longer than the longest a procedure holds its request open
 * (`holdsOpenSeconds`, ADR 0124): `models.build`'s 160 seconds, the server's wait on the
 * worker's build plus the time to answer (ADR 0126). At 120 the CLI gave up on a build the
 * server was still waiting for (issue 442). A stalled connection past it is reported as a
 * TIMEOUT an agent may retry, not a hang.
 */
export const REQUEST_TIMEOUT_MS = 180_000;

export interface Connection {
  readonly url: string;
  readonly origin: string;
  /** What this origin is shown -- its session, or a token -- or `null` to call as nobody. */
  readonly credential: Presented | null;
  readonly locale: Locale;
  readonly fetch: typeof fetch;
  /** Diagnostics for `--verbose`. Never given a header, a cookie or a body. */
  readonly trace: (line: string) => void;
}

/**
 * The CLI's code for a tRPC error code, by the control plane's own table (`BY_TRPC_CODE`, baked
 * in by the build). A code it lacks -- a server newer than this bundle -- is an INTERNAL_ERROR.
 */
const SURFACE_CODE: ReadonlyMap<string, SurfaceErrorCode> = new Map(Object.entries(BY_TRPC_CODE));

/**
 * The header that tells the server this is the CLI, so its audit log can say so (ADR 0113). Sent
 * on every request the CLI makes. Typed off the server's own constant, so the spelling cannot drift.
 */
export const CLIENT_HEADERS: Readonly<
  Record<(typeof CLI_HEADER)["name"], (typeof CLI_HEADER)["value"]>
> = { "x-undercroft-client": "cli" };

/**
 * Every header a request to this origin carries -- the CLI's name, the language, the credential
 * -- or the refusal for a token whose variable is unset, decided before anything is sent.
 *
 * A token is sent as the bearer and a session as the cookie, never both: a request carrying
 * `Authorization` is admitted by the bearer alone, so a cookie beside it would be sent for
 * nothing.
 */
export function headersFor(
  t: Translate,
  connection: Connection,
): { readonly ok: true; readonly headers: Readonly<Record<string, string>> } | Refusal {
  const base = { ...CLIENT_HEADERS, "accept-language": connection.locale };
  const { credential } = connection;
  if (credential === null) {
    return { ok: true, headers: base };
  }
  if (credential.kind === "session") {
    return { ok: true, headers: { ...base, cookie: credential.cookie } };
  }
  if (credential.token === null) {
    return failure(
      "AUTHENTICATION_REQUIRED",
      t("error.tokenUnset", { variable: credential.variable, origin: connection.origin }),
    );
  }
  return { ok: true, headers: { ...base, authorization: `Bearer ${credential.token}` } };
}

/**
 * The CLI's own sentence for UNAUTHORIZED, which the server leaves unworded on purpose. Only the
 * CLI knows how it signed in, so only it can say what to do: sign in again, or -- for a token,
 * which signing in again with the same variable would not fix -- mint a new one.
 */
export function signInRequired(t: Translate, connection: Connection): Refusal {
  const { credential, origin } = connection;
  return failure(
    "AUTHENTICATION_REQUIRED",
    credential?.kind === "token"
      ? t("error.tokenRefused", { variable: credential.variable, origin })
      : t("error.AUTHENTICATION_REQUIRED", { origin }),
  );
}

/**
 * A token's grant refusing the call (`WRITES_DISABLED` in the facts, `trpc.ts`'s grant guard),
 * with the grant it needs beside the one it holds. Always `write`: the guard refuses only a
 * `read` grant, and only a call that is not a read -- which includes `lake.query` and
 * `models.preview`, classed `write` for what their SQL could do.
 */
function grantRefusal(
  t: Translate,
  connection: Connection,
  message: string,
  details: Readonly<Record<string, unknown>>,
): Refusal {
  const { credential } = connection;
  return failure(
    "PERMISSION_DENIED",
    credential?.kind === "token"
      ? t("error.tokenReadOnly", { variable: credential.variable })
      : message,
    { ...details, needs: "write" },
  );
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** The cause at the bottom of a chain, for telling a timeout from a refused connection. */
function rootCause(error: unknown): unknown {
  let current = error;
  while (current instanceof Error && current.cause !== undefined) {
    current = current.cause;
  }
  return current;
}

export function unreachable(t: Translate, connection: Connection, error: unknown): Refusal {
  if (isTimeout(error) || isTimeout(rootCause(error))) {
    return failure(
      "TIMEOUT",
      t("error.TIMEOUT", {
        origin: connection.origin,
        seconds: String(REQUEST_TIMEOUT_MS / 1000),
      }),
    );
  }
  return failure("NETWORK_ERROR", t("error.NETWORK_ERROR", { origin: connection.origin }));
}

/**
 * The zod issues inside a BAD_REQUEST, when that is what it carries.
 *
 * tRPC words an input-validation failure as the JSON of zod's issue list. That is useful to
 * an agent as data and unreadable as a sentence, so it moves to `details` and the message
 * becomes the CLI's own. A BAD_REQUEST the router worded itself keeps its sentence.
 */
function zodIssues(message: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(message);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The refusal, carrying the trace id the server named for the request (`data.traceId`, set by
 * the control plane's error formatter) -- the one handle that leads from this answer to the
 * server's record of it. Absent when the server did not name one.
 */
function refused(
  t: Translate,
  connection: Connection,
  error: Readonly<Record<string, unknown>>,
): Refusal {
  const refusal = worded(t, connection, error);
  const traceId = isRecord(error.data) ? error.data.traceId : undefined;
  return typeof traceId === "string" && traceId !== ""
    ? { ok: false, error: { ...refusal.error, traceId } }
    : refusal;
}

/** tRPC's `{ error: { message, data: { code } } }`, as the CLI's refusal. */
function worded(
  t: Translate,
  connection: Connection,
  error: Readonly<Record<string, unknown>>,
): Refusal {
  const trpcCode = isRecord(error.data) ? error.data.code : undefined;
  const message = typeof error.message === "string" ? error.message : "";
  const code =
    (typeof trpcCode === "string" ? SURFACE_CODE.get(trpcCode) : undefined) ?? "INTERNAL_ERROR";
  const issues = code === "VALIDATION_FAILED" ? zodIssues(message) : null;
  if (issues !== null) {
    return failure(code, t("error.VALIDATION_FAILED"), { issues });
  }
  // A refusal the server did not word -- tRPC then repeats the code as the message -- gets
  // the CLI's sentence. UNAUTHORIZED and NOT_FOUND are deliberately unworded on the server,
  // so that they confirm nothing; the CLI's sentence for them confirms nothing either.
  // INTERNAL_SERVER_ERROR arrives already stripped to `internal_error` (`trpc.ts`).
  const isWorded =
    code !== "INTERNAL_ERROR" &&
    code !== "AUTHENTICATION_REQUIRED" &&
    message !== "" &&
    message !== trpcCode;
  const details = isRecord(error.data) ? error.data.details : undefined;
  if (isWorded && isRecord(details) && details.reason === "WRITES_DISABLED") {
    return grantRefusal(t, connection, message, details);
  }
  if (isWorded) {
    // With the facts the router named beside its sentence, when it named any: which listing
    // could not be had and what fixes it (`refusal` in the control plane's `trpc.ts`). Passed
    // through verbatim -- re-deriving them here would mean parsing a sentence in whatever
    // language the server answered in.
    return failure(code, message, details);
  }
  if (code === "AUTHENTICATION_REQUIRED") {
    return signInRequired(t, connection);
  }
  return failure(code, t(`error.${code}`, { origin: connection.origin }));
}

/** The request tRPC 11.0.0's fetch adapter reads for one non-batched call. See the docstring. */
function trpcRequest(
  connection: Connection,
  spec: Pick<ProcedureSpec, "path" | "type">,
  input: unknown,
  sent: Readonly<Record<string, string>>,
): { readonly url: string; readonly init: RequestInit } {
  const base = `${connection.url}/trpc/${spec.path}`;
  const headers = { "content-type": "application/json", ...sent };
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (spec.type === "query") {
    const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    return { url: `${base}${query}`, init: { method: "GET", headers, signal } };
  }
  return {
    url: base,
    init:
      input === undefined
        ? { method: "POST", headers, signal }
        : { method: "POST", headers, signal, body: JSON.stringify(input) },
  };
}

/** Call the procedure a manifest entry describes, with an input assembled from argv. */
export async function callSpec(
  t: Translate,
  connection: Connection,
  spec: Pick<ProcedureSpec, "path" | "type">,
  input: unknown,
): Promise<Outcome> {
  const sent = headersFor(t, connection);
  if (!sent.ok) {
    return sent;
  }
  const { url, init } = trpcRequest(connection, spec, input, sent.headers);
  connection.trace(`${init.method ?? "GET"} ${connection.origin}/trpc/${spec.path}`);
  let body: unknown;
  try {
    const response = await connection.fetch(url, init);
    connection.trace(`-> ${String(response.status)}`);
    body = await response.json();
  } catch (error) {
    // No answer, or an answer that is not JSON -- a proxy's error page, a URL that is not an
    // Undercroft server. Neither is the platform refusing; both are "could not reach it".
    connection.trace(`failed: ${error instanceof Error ? error.message : String(error)}`);
    return unreachable(t, connection, error);
  }
  if (isRecord(body) && isRecord(body.result)) {
    return success(body.result.data);
  }
  if (isRecord(body) && isRecord(body.error)) {
    return refused(t, connection, body.error);
  }
  return unreachable(t, connection, null);
}

/**
 * Call a procedure the CLI's own code names, checked against the router by the compiler.
 *
 * The path must be one the router has, `type` must be the one it declares (a query is a GET,
 * so a procedure that became a mutation would otherwise be sent the wrong way), and `input`
 * must be what its zod input accepts. A procedure renamed, deleted or reshaped in the router is
 * therefore a `tsc` error at the call, not a NOT_FOUND somebody meets at a terminal.
 */
export function callProcedure<P extends ProcedurePath>(
  t: Translate,
  connection: Connection,
  procedure: { readonly path: P; readonly type: KindOf<P> },
  input: InputOf<P>,
): Promise<Outcome> {
  return callSpec(t, connection, procedure, input);
}
