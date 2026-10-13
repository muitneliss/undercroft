/**
 * The sessions this CLI holds, keyed by the ORIGIN that issued each one.
 *
 * A session cookie is a bearer credential: whoever presents it is that person until the
 * server deletes the row. So it is sent back only to the origin that set it -- scheme, host
 * and port, compared exactly. `http://localhost:3000` and `http://127.0.0.1:3000` are two
 * origins here even when they reach the same process, and a staging login can never be
 * replayed at production because a profile was renamed or two URLs look alike. It is keyed by
 * origin rather than by profile name for the same reason: two profiles pointing at one server
 * share its session, and a profile repointed elsewhere does not carry its old one along.
 *
 * `credentials.json` is written 0600 through `store.ts`, and nothing in this CLI prints it --
 * `config show` reports whether a session exists, never what it is.
 *
 * A script or an agent with nobody at its terminal signs in with a personal access token instead
 * (ADR 0134), and then what is kept is not the token: it is the NAME of the environment variable
 * the token is read from, at every call. The token stays wherever its owner put it -- a secret
 * store, a CI variable -- so it is in no file, no argv and no output of this CLI, and revoking it
 * on `/account` is the whole of withdrawing it. The address is kept beside it for the same
 * reason as a session's: to say who is signed in without asking the server.
 */

import { join } from "node:path";
import type { Translate } from "../i18n/index.ts";
import { type Failure, isFailure } from "./output.ts";
import type { Env } from "./profiles.ts";
import { isRecord, readJson, writeJson } from "./store.ts";

/** A session cookie this CLI holds, or the variable a personal access token is read from. */
export type Credential =
  | { readonly email: string; readonly cookie: string }
  | { readonly email: string; readonly tokenEnv: string };

/**
 * What a request presents to the origin, read at the moment it is made: the session cookie, or
 * the token in its variable -- `null` when that variable is unset or empty, which the request
 * refuses rather than sending nothing and being told, misleadingly, that nobody is signed in.
 */
export type Presented =
  | { readonly kind: "session"; readonly cookie: string }
  | { readonly kind: "token"; readonly variable: string; readonly token: string | null };

/**
 * A portable environment variable's name (POSIX): what `--token-env` takes. Checked so that the
 * token itself, pasted where its variable's name belongs, is refused rather than written into
 * `credentials.json` -- a token always holds a `.`, which no name does.
 */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function isVariableName(name: string): boolean {
  return VARIABLE_NAME.test(name);
}

export function presented(credential: Credential, env: Env): Presented {
  if ("cookie" in credential) {
    return { kind: "session", cookie: credential.cookie };
  }
  const token = env[credential.tokenEnv]?.trim() ?? "";
  return { kind: "token", variable: credential.tokenEnv, token: token === "" ? null : token };
}

function credentialOf(value: unknown): Credential | null {
  if (!isRecord(value) || typeof value.email !== "string") {
    return null;
  }
  if (typeof value.cookie === "string") {
    return { email: value.email, cookie: value.cookie };
  }
  return typeof value.tokenEnv === "string" && isVariableName(value.tokenEnv)
    ? { email: value.email, tokenEnv: value.tokenEnv }
    : null;
}

type Credentials = Readonly<Record<string, Credential>>;

function credentialsPath(home: string): string {
  return join(home, "credentials.json");
}

function load(t: Translate, home: string): Credentials | Failure {
  const path = credentialsPath(home);
  const read = readJson(path);
  if (!read.ok || (read.value !== undefined && !isRecord(read.value))) {
    return { code: "CONFIG_REQUIRED", message: t("error.configUnreadable", { path }) };
  }
  const found: Record<string, Credential> = {};
  for (const [origin, value] of Object.entries(read.value ?? {})) {
    const credential = credentialOf(value);
    if (credential !== null) {
      found[origin] = credential;
    }
  }
  return found;
}

/** The session this origin issued, `null` when there is none. */
export function credentialFor(
  t: Translate,
  home: string,
  origin: string,
): Credential | null | Failure {
  const all = load(t, home);
  return isFailure(all) ? all : (all[origin] ?? null);
}

/**
 * Keep a session for an origin.
 *
 * Refuses over an unreadable file rather than replacing it: overwriting would silently sign
 * the person out of every other environment the file held.
 */
export function saveCredential(
  t: Translate,
  home: string,
  origin: string,
  credential: Credential,
): Failure | null {
  const all = load(t, home);
  if (isFailure(all)) {
    return all;
  }
  writeJson(credentialsPath(home), { ...all, [origin]: credential }, 0o600);
  return null;
}

export function forgetCredential(t: Translate, home: string, origin: string): Failure | null {
  const all = load(t, home);
  if (isFailure(all)) {
    return all;
  }
  const { [origin]: _forgotten, ...rest } = all;
  writeJson(credentialsPath(home), rest, 0o600);
  return null;
}
