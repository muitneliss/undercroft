/**
 * What every handler is given, built once by `main.ts` and passed down.
 *
 * `main.ts` is the composition root and the only module that reads argv, the environment,
 * the standard streams and the global `fetch` (`layering.md`, `layer-injected-deps`). This is
 * the shape it hands them over in, so a handler never reaches for `process` and the whole CLI
 * can be driven by a caller that supplies different ones.
 */

import type { Readable, Writable } from "node:stream";
import type { Locale } from "@undercroft/core/locale";
import type { Translate } from "../i18n/index.ts";
import { type Credential, credentialFor } from "../services/credentials.ts";
import type { RuntimeMode } from "../services/mode.ts";
import { fromFailure, isFailure, type Refusal } from "../services/output.ts";
import {
  type CliConfig,
  type Env,
  readConfig,
  resolveTarget,
  type Target,
} from "../services/profiles.ts";
import type { Connection } from "./remote.ts";

export interface Context {
  readonly t: Translate;
  readonly locale: Locale;
  readonly mode: RuntimeMode;
  readonly env: Env;
  readonly cwd: string;
  /** Where `config.json` and `credentials.json` live. */
  readonly home: string;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly fetch: typeof fetch;
  /** A `--verbose` line on stderr; a no-op otherwise. */
  readonly trace: (line: string) => void;
}

/** oclif's parsed flags, read through the two narrowing helpers below rather than as `any`. */
export type ParsedFlags = Readonly<Record<string, unknown>>;

export function stringFlag(flags: ParsedFlags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function booleanFlag(flags: ParsedFlags, name: string): boolean {
  return flags[name] === true;
}

export function loadConfig(ctx: Context): CliConfig | Refusal {
  const config = readConfig(ctx.t, ctx.home);
  return isFailure(config) ? fromFailure(config) : config;
}

export interface Connected {
  readonly target: Target;
  readonly credential: Credential | null;
  readonly connection: Connection;
}

/** The server this invocation addresses and the session it holds there, if any. */
export function connect(ctx: Context, flags: ParsedFlags): Connected | Refusal {
  const config = loadConfig(ctx);
  if ("ok" in config) {
    return config;
  }
  const target = resolveTarget(ctx.t, {
    flags: { url: stringFlag(flags, "url"), profile: stringFlag(flags, "profile") },
    env: ctx.env,
    cwd: ctx.cwd,
    config,
  });
  if (isFailure(target)) {
    return fromFailure(target);
  }
  const credential = credentialFor(ctx.t, ctx.home, target.origin);
  if (credential !== null && isFailure(credential)) {
    return fromFailure(credential);
  }
  return {
    target,
    credential,
    connection: {
      url: target.url,
      origin: target.origin,
      cookie: credential?.cookie ?? null,
      locale: ctx.locale,
      fetch: ctx.fetch,
      trace: ctx.trace,
    },
  };
}
