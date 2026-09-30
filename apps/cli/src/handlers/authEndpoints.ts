/**
 * Better Auth's sign-in endpoints under `/api/auth`, spoken over `node:http`.
 *
 * Three POSTs, and the CLI's only way to get a session: the email one-time code the SPA uses
 * (`/api/auth/email-otp/...`, two steps), and on an install served on this machine the local
 * method its page uses (`/api/auth/sign-in/dev`, ADR 0096). Each answers with a cookie that
 * `services/credentials.ts` keeps under its origin; which endpoint issued it is forgotten there,
 * because nothing downstream has a second kind of session to know about.
 *
 * These POSTs carry no cookie and no browser fetch metadata, which is the case Better Auth's
 * CSRF check lets through without an Origin -- so the CLI needs no header it would have to
 * fake. That takes `node:http` rather than `fetch`; `postAuth` says why. Every other call the
 * CLI makes is tRPC, in `remote.ts`.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Translate } from "../i18n/index.ts";
import { failure, type Outcome, type Refusal, success } from "../services/output.ts";
import { isRecord } from "../services/store.ts";
import { type Connection, REQUEST_TIMEOUT_MS, unreachable } from "./remote.ts";

/** What a sign-in endpoint answered that the CLI reads: the status, the cookies it set, its body. */
interface AuthAnswer {
  readonly status: number;
  readonly setCookie: readonly string[];
  /**
   * The body as JSON, or `null` when it was not JSON. Better Auth's own endpoints answer in
   * English, so what they say is never passed on; only the local method's answer is read, and
   * its refusals are the control plane's own localized sentences (`devSignIn.ts`).
   */
  readonly body: unknown;
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            setCookie: response.headers["set-cookie"] ?? [],
            body: jsonOrNull(Buffer.concat(chunks).toString("utf8")),
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

/** Exchange the code for a session, answering with the cookie to keep. */
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
  const cookie = sessionCookie(answer);
  return cookie === null
    ? failure("INTERNAL_ERROR", t("error.INTERNAL_ERROR"))
    : { ok: true, cookie };
}

/**
 * The `Cookie` header that carries the session an answer set, or `null` when it set none.
 *
 * Only each `Set-Cookie`'s `name=value` is kept: the attributes after it describe the cookie
 * to a browser and mean nothing sent back in a `Cookie` header.
 */
function sessionCookie(answer: AuthAnswer): string | null {
  const cookie = answer.setCookie
    .map((header) => header.split(";", 1)[0]?.trim() ?? "")
    .filter((pair) => pair !== "")
    .join("; ");
  return cookie === "" ? null : cookie;
}

/**
 * Sign in with the local method, `POST /api/auth/sign-in/dev`, the one a desktop install's page
 * uses (ADR 0094, ADR 0096), answering with the cookie to keep and the address it signed in as.
 *
 * The server chooses who that is, never the request, so the address is read from its answer.
 * Addressed to `connection.url` exactly: the server refuses a request whose `Host` is not its
 * public URL's, and `node:http` writes `Host` from the URL it is given, as a browser does.
 *
 * A 403 carries the server's own sentence in the reader's language -- the address to use
 * instead when this one is `127.0.0.1` and the install says `localhost`, or that the address is
 * not invited -- so it is passed on as it came. A 404 is a server that offers no local method.
 */
export async function signInLocally(
  t: Translate,
  connection: Connection,
): Promise<{ readonly ok: true; readonly cookie: string; readonly email: string } | Refusal> {
  let answer: AuthAnswer;
  try {
    answer = await postAuth(connection, "/api/auth/sign-in/dev", {});
  } catch (error) {
    return unreachable(t, connection, error);
  }
  if (answer.status === 403) {
    const said = isRecord(answer.body) ? answer.body.message : undefined;
    return failure(
      "PERMISSION_DENIED",
      typeof said === "string" && said !== "" ? said : t("error.PERMISSION_DENIED"),
      { status: answer.status },
    );
  }
  if (answer.status === 404) {
    return failure("NOT_FOUND", t("error.noLocalMethod", { origin: connection.origin }), {
      status: answer.status,
    });
  }
  if (!isOk(answer.status)) {
    return authRefusal(t, connection, answer.status);
  }
  const cookie = sessionCookie(answer);
  const email = isRecord(answer.body) ? answer.body.email : undefined;
  return cookie === null || typeof email !== "string" || email === ""
    ? failure("INTERNAL_ERROR", t("error.INTERNAL_ERROR"))
    : { ok: true, cookie, email };
}
