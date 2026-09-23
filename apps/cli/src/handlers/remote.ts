/**
 * The CLI's only way into the platform: HTTP to the same `/trpc` and `/api/auth` the web UI
 * calls, carrying the person's own Better Auth session cookie.
 *
 * That is the whole reason the CLI is not a backdoor. Every procedure answers here exactly as
 * it answers the browser -- `tenantProcedure`'s authority check, `requireRole`, the
 * 404-not-403 boundary and the localized refusals all run on the server, and none of them is
 * re-implemented or bypassed. There is no DSN, no service token and no second auth path.
 * `.ast-grep/rules/cli-boundary.yml` keeps it that way.
 *
 * Sign-in is the email one-time code the SPA uses (`/api/auth/email-otp/...`). Its two POSTs
 * carry no cookie and no browser fetch metadata, which is the case Better Auth's CSRF check
 * lets through without an Origin -- so the CLI needs no header it would have to fake. That
 * takes `node:http` rather than `fetch`; `postAuth` says why.
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

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Locale } from "@undercroft/core/locale";
import type { Translate } from "../i18n/index.ts";
import type { ProcedureSpec } from "../manifest.ts";
import {
  type ErrorCode,
  failure,
  type Outcome,
  type Refusal,
  success,
} from "../services/output.ts";

/**
 * How long one request may take. Long enough for a model build, which the server waits on;
 * a stalled connection past it is reported as a TIMEOUT an agent may retry, not a hang.
 */
const REQUEST_TIMEOUT_MS = 120_000;

export interface Connection {
  readonly url: string;
  readonly origin: string;
  /** The session this origin issued, or `null` to call as nobody. */
  readonly cookie: string | null;
  readonly locale: Locale;
  readonly fetch: typeof fetch;
  /** Diagnostics for `--verbose`. Never given a header, a cookie or a body. */
  readonly trace: (line: string) => void;
}

/**
 * tRPC's error codes, as the CLI's.
 *
 * `PRECONDITION_FAILED` is the router's "the worker did not answer" and "no rows stored":
 * the request was fine and the platform's state refused it, which is what CONFLICT means to a
 * caller. The server's own sentence says which, and is passed through.
 */
const BY_TRPC_CODE: Readonly<Record<string, ErrorCode>> = {
  UNAUTHORIZED: "AUTHENTICATION_REQUIRED",
  FORBIDDEN: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "CONFLICT",
  BAD_REQUEST: "VALIDATION_FAILED",
  PARSE_ERROR: "VALIDATION_FAILED",
  PAYLOAD_TOO_LARGE: "VALIDATION_FAILED",
  UNPROCESSABLE_CONTENT: "VALIDATION_FAILED",
  TIMEOUT: "TIMEOUT",
  TOO_MANY_REQUESTS: "NETWORK_ERROR",
};

function headersFor(connection: Connection): Record<string, string> {
  return {
    "accept-language": connection.locale,
    ...(connection.cookie === null ? {} : { cookie: connection.cookie }),
  };
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

function unreachable(t: Translate, connection: Connection, error: unknown): Refusal {
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

/** tRPC's `{ error: { message, data: { code } } }`, as the CLI's refusal. */
function refused(
  t: Translate,
  connection: Connection,
  error: Readonly<Record<string, unknown>>,
): Refusal {
  const trpcCode = isRecord(error.data) ? error.data.code : undefined;
  const message = typeof error.message === "string" ? error.message : "";
  const code =
    (typeof trpcCode === "string" ? BY_TRPC_CODE[trpcCode] : undefined) ?? "INTERNAL_ERROR";
  const issues = code === "VALIDATION_FAILED" ? zodIssues(message) : null;
  if (issues !== null) {
    return failure(code, t("error.VALIDATION_FAILED"), { issues });
  }
  // A refusal the server did not word -- tRPC then repeats the code as the message -- gets
  // the CLI's sentence. UNAUTHORIZED and NOT_FOUND are deliberately unworded on the server,
  // so that they confirm nothing; the CLI's sentence for them confirms nothing either.
  // INTERNAL_SERVER_ERROR arrives already stripped to `internal_error` (`trpc.ts`).
  const worded =
    code !== "INTERNAL_ERROR" &&
    code !== "AUTHENTICATION_REQUIRED" &&
    message !== "" &&
    message !== trpcCode;
  if (worded) {
    return failure(code, message);
  }
  return failure(code, t(`error.${code}`, { origin: connection.origin }));
}

/** The request tRPC 11.0.0's fetch adapter reads for one non-batched call. See the docstring. */
function trpcRequest(
  connection: Connection,
  spec: Pick<ProcedureSpec, "path" | "type">,
  input: unknown,
): { readonly url: string; readonly init: RequestInit } {
  const base = `${connection.url}/trpc/${spec.path}`;
  const headers = { "content-type": "application/json", ...headersFor(connection) };
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

/** Call one procedure by its dotted path and answer with what the server said. */
export async function callProcedure(
  t: Translate,
  connection: Connection,
  spec: Pick<ProcedureSpec, "path" | "type">,
  input: unknown,
): Promise<Outcome> {
  const { url, init } = trpcRequest(connection, spec, input);
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

/** What a sign-in endpoint answered that the CLI reads: the status and the cookies it set. */
interface AuthAnswer {
  readonly status: number;
  readonly setCookie: readonly string[];
}

/**
 * POST to a sign-in endpoint through `node:http`, carrying only the headers written here.
 *
 * NOT `fetch`, and the reason was found by running the CLI against a real server. Node's
 * `fetch` (undici) sends `Sec-Fetch-Mode: cors` on every request and will not be told
 * otherwise. Better Auth reads any `Sec-Fetch-*` header as "a browser sent this" and then
 * demands an Origin from its trusted list (`validateFormCsrf`, better-auth 1.7.5), so every
 * sign-in from `fetch` was refused `MISSING_OR_NULL_ORIGIN`. A CLI is not a browser: it holds
 * no ambient cookie a hostile page could ride on, and it should not forge an Origin to pass a
 * check written for one. A plain request takes Better Auth's non-browser branch, as `curl`
 * does. The suite proves it only because `createAuth` now runs that check under test as well.
 */
function postAuth(
  connection: Connection,
  path: string,
  body: Readonly<Record<string, string>>,
): Promise<AuthAnswer> {
  const url = new URL(`${connection.url}${path}`);
  const payload = JSON.stringify(body);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  connection.trace(`POST ${connection.origin}${path}`);
  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
          "accept-language": connection.locale,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
      (response) => {
        // Drained, not read: the body is Better Auth's English and is never passed on.
        response.resume();
        response.on("error", reject);
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            setCookie: response.headers["set-cookie"] ?? [],
          });
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/** A sign-in endpoint's refusal, by status. Better Auth's own body is English and not passed on. */
function authRefusal(t: Translate, connection: Connection, status: number): Refusal {
  if (status === 404) {
    return failure("NOT_FOUND", t("error.NOT_FOUND"), { status });
  }
  if (status === 429) {
    return failure("NETWORK_ERROR", t("error.NETWORK_ERROR", { origin: connection.origin }), {
      status,
    });
  }
  if (status >= 500) {
    return failure("INTERNAL_ERROR", t("error.INTERNAL_ERROR"), { status });
  }
  return failure("VALIDATION_FAILED", t("error.VALIDATION_FAILED"), { status });
}

/**
 * Ask for a one-time code.
 *
 * The server answers 200 whether or not the address has access -- answering honestly would
 * make the form an oracle for who can sign in -- so success here means "asked", never "sent".
 */
export async function requestCode(
  t: Translate,
  connection: Connection,
  email: string,
): Promise<Outcome> {
  try {
    const answer = await postAuth(connection, "/api/auth/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    return isOk(answer.status)
      ? success({ codeRequested: true })
      : authRefusal(t, connection, answer.status);
  } catch (error) {
    return unreachable(t, connection, error);
  }
}

/**
 * Exchange the code for a session, answering with the cookie to keep.
 *
 * Only each `Set-Cookie`'s `name=value` is kept: the attributes after it describe the
 * cookie to a browser and mean nothing sent back in a `Cookie` header.
 */
export async function signIn(
  t: Translate,
  connection: Connection,
  email: string,
  code: string,
): Promise<{ readonly ok: true; readonly cookie: string } | Refusal> {
  let answer: AuthAnswer;
  try {
    answer = await postAuth(connection, "/api/auth/sign-in/email-otp", { email, otp: code });
  } catch (error) {
    return unreachable(t, connection, error);
  }
  if (answer.status === 400 || answer.status === 401 || answer.status === 403) {
    return failure("AUTHENTICATION_REQUIRED", t("error.codeRejected"), { status: answer.status });
  }
  if (!isOk(answer.status)) {
    return authRefusal(t, connection, answer.status);
  }
  const cookie = answer.setCookie
    .map((header) => header.split(";", 1)[0]?.trim() ?? "")
    .filter((pair) => pair !== "")
    .join("; ");
  return cookie === ""
    ? failure("INTERNAL_ERROR", t("error.INTERNAL_ERROR"))
    : { ok: true, cookie };
}
