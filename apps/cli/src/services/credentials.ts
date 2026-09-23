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
 */

import { join } from "node:path";
import type { Translate } from "../i18n/index.ts";
import { type Failure, isFailure } from "./output.ts";
import { isRecord, readJson, writeJson } from "./store.ts";

export interface Credential {
  readonly email: string;
  readonly cookie: string;
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
    if (isRecord(value) && typeof value.email === "string" && typeof value.cookie === "string") {
      found[origin] = { email: value.email, cookie: value.cookie };
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
