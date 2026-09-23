/**
 * Which server this invocation talks to, and whether it may change anything there.
 *
 * Environments are NAMED PROFILES in `config.json`: `{ url, allowWrites }` under a name, so
 * local, staging and production are three entries rather than three environment variables a
 * shell can mix up. The resolution order is fixed and reported by `config show`:
 *
 *   URL      --url, then UNDERCROFT_URL, then the profile's
 *   profile  --profile, then UNDERCROFT_PROFILE, then the nearest `undercroft.cli.json`,
 *            then `defaultProfile`
 *
 * Nothing defaults to localhost. With none of these the answer is CONFIG_REQUIRED, because a
 * CLI that guessed a server would one day send a production command to the wrong one -- or
 * a development one to production.
 *
 * `allowWrites` belongs to a NAMED profile and to nothing else. A one-off `--url` or
 * `UNDERCROFT_URL` never carries it, so the only way to write is through an entry a person
 * created on purpose. And only a person may create that permission: `planProfileChange`
 * refuses, in agent mode, any change that would let writes reach a server a person has not
 * approved -- granting it, or pointing an approved profile at a different URL. ADR 0044.
 */

import { join } from "node:path";
import type { Translate } from "../i18n/index.ts";
import type { Mode } from "./mode.ts";
import { type Failure, isFailure } from "./output.ts";
import { isRecord, readJson, writeJson } from "./store.ts";

export interface Profile {
  readonly url: string;
  readonly allowWrites: boolean;
}

export interface CliConfig {
  readonly defaultProfile: string | null;
  readonly profiles: Readonly<Record<string, Profile>>;
}

export type Env = Readonly<Record<string, string | undefined>>;

const PROJECT_FILE = "undercroft.cli.json";
const TRAILING_SLASHES = /\/+$/u;

/** `$UNDERCROFT_CLI_HOME`, else `$XDG_CONFIG_HOME/undercroft`, else `~/.config/undercroft`. */
export function cliHome(env: Env, homedir: string): string {
  const explicit = env.UNDERCROFT_CLI_HOME;
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg !== undefined && xdg !== "" ? xdg : join(homedir, ".config"), "undercroft");
}

function configPath(home: string): string {
  return join(home, "config.json");
}

/**
 * A server's base URL, normalised, or `null` when it is not an http(s) URL.
 *
 * Kept with its path so a control plane served under a prefix still works; the query and the
 * fragment are dropped, because neither can be part of where `/trpc` lives.
 */
export function normalizeUrl(
  raw: string,
): { readonly url: string; readonly origin: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return {
    url: `${parsed.origin}${parsed.pathname.replace(TRAILING_SLASHES, "")}`,
    origin: parsed.origin,
  };
}

/** A profile as the file holds it. `allowWrites` is true only when it says exactly `true`. */
function profileFrom(value: unknown): Profile | null {
  if (!isRecord(value) || typeof value.url !== "string") {
    return null;
  }
  return { url: value.url, allowWrites: value.allowWrites === true };
}

export function readConfig(t: Translate, home: string): CliConfig | Failure {
  const path = configPath(home);
  const read = readJson(path);
  if (!read.ok || (read.value !== undefined && !isRecord(read.value))) {
    return { code: "CONFIG_REQUIRED", message: t("error.configUnreadable", { path }) };
  }
  const raw = read.value ?? {};
  const profiles: Record<string, Profile> = {};
  if (isRecord(raw.profiles)) {
    for (const [name, value] of Object.entries(raw.profiles)) {
      const profile = profileFrom(value);
      if (profile !== null) {
        profiles[name] = profile;
      }
    }
  }
  return {
    defaultProfile: typeof raw.defaultProfile === "string" ? raw.defaultProfile : null,
    profiles,
  };
}

export function writeConfig(home: string, config: CliConfig): void {
  writeJson(configPath(home), config, 0o644);
}

/** The profile a project pins, from the nearest `undercroft.cli.json` above `cwd`. */
function projectProfile(
  t: Translate,
  cwd: string,
): { readonly profile: string; readonly path: string } | Failure | null {
  let dir = cwd;
  for (;;) {
    const path = join(dir, PROJECT_FILE);
    const read = readJson(path);
    if (!read.ok) {
      return { code: "CONFIG_REQUIRED", message: t("error.configUnreadable", { path }) };
    }
    if (read.value !== undefined) {
      return isRecord(read.value) && typeof read.value.profile === "string"
        ? { profile: read.value.profile, path }
        : { code: "CONFIG_REQUIRED", message: t("error.configUnreadable", { path }) };
    }
    const parent = join(dir, "..");
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export type UrlSource = "flag" | "env" | "profile";
export type ProfileSource = "flag" | "env" | "project" | "default";

export interface Target {
  readonly url: string;
  readonly origin: string;
  /** `null` for a one-off URL, which is also why such a target never allows writes. */
  readonly profile: string | null;
  readonly allowWrites: boolean;
  readonly urlSource: UrlSource;
  readonly profileSource: ProfileSource | null;
  readonly projectFile: string | null;
}

export interface TargetInput {
  readonly flags: { readonly url?: string | undefined; readonly profile?: string | undefined };
  readonly env: Env;
  readonly cwd: string;
  readonly config: CliConfig;
}

function oneOff(t: Translate, raw: string, source: UrlSource): Target | Failure {
  const normalized = normalizeUrl(raw);
  if (normalized === null) {
    return { code: "INVALID_ARGUMENT", message: t("error.INVALID_ARGUMENT", { command: "--url" }) };
  }
  return {
    ...normalized,
    profile: null,
    allowWrites: false,
    urlSource: source,
    profileSource: null,
    projectFile: null,
  };
}

function chosenProfile(
  t: Translate,
  input: TargetInput,
): { name: string; source: ProfileSource; projectFile: string | null } | Failure | null {
  if (input.flags.profile !== undefined) {
    return { name: input.flags.profile, source: "flag", projectFile: null };
  }
  const fromEnv = input.env.UNDERCROFT_PROFILE;
  if (fromEnv !== undefined && fromEnv !== "") {
    return { name: fromEnv, source: "env", projectFile: null };
  }
  const project = projectProfile(t, input.cwd);
  if (project !== null) {
    return isFailure(project)
      ? project
      : { name: project.profile, source: "project", projectFile: project.path };
  }
  const fallback = input.config.defaultProfile;
  return fallback === null ? null : { name: fallback, source: "default", projectFile: null };
}

export function resolveTarget(t: Translate, input: TargetInput): Target | Failure {
  if (input.flags.url !== undefined) {
    return oneOff(t, input.flags.url, "flag");
  }
  const fromEnv = input.env.UNDERCROFT_URL;
  if (fromEnv !== undefined && fromEnv !== "") {
    return oneOff(t, fromEnv, "env");
  }
  const chosen = chosenProfile(t, input);
  if (chosen === null) {
    return { code: "CONFIG_REQUIRED", message: t("error.CONFIG_REQUIRED") };
  }
  if (isFailure(chosen)) {
    return chosen;
  }
  const profile = input.config.profiles[chosen.name];
  const normalized = profile === undefined ? null : normalizeUrl(profile.url);
  if (profile === undefined || normalized === null) {
    return {
      code: "CONFIG_REQUIRED",
      message: t("error.unknownProfile", { profile: chosen.name }),
    };
  }
  return {
    ...normalized,
    profile: chosen.name,
    allowWrites: profile.allowWrites,
    urlSource: "profile",
    profileSource: chosen.source,
    projectFile: chosen.projectFile,
  };
}

export interface ProfileChange {
  readonly url?: string | undefined;
  readonly allowWrites?: boolean | undefined;
}

/**
 * The config after one profile is created or changed, or the reason it may not be.
 *
 * The agent-mode refusal is the whole point of `allowWrites`, so it is argued here once:
 *
 * - Granting writes is a person's decision. An agent acting on injected text could otherwise
 *   grant itself the permission this flag exists to withhold.
 * - Moving a profile that already allows writes to another URL is the same grant by another
 *   route -- the permission a person gave one server would silently apply to a second.
 * - Withdrawing writes, or pointing a read-only profile somewhere, is allowed: it can only
 *   take authority away, and refusing it would stop an agent from making itself safer.
 *
 * The first profile ever written becomes the default: with exactly one, there is nothing to
 * choose between.
 */
export function planProfileChange(
  t: Translate,
  input: {
    readonly config: CliConfig;
    readonly name: string;
    readonly change: ProfileChange;
    readonly mode: Mode;
  },
): CliConfig | Failure {
  const { config, name, change, mode } = input;
  const existing = config.profiles[name];
  const rawUrl = change.url ?? existing?.url;
  if (rawUrl === undefined) {
    return {
      code: "MISSING_REQUIRED_ARGUMENT",
      message: t("error.MISSING_REQUIRED_ARGUMENT", { names: "--url" }),
    };
  }
  const normalized = normalizeUrl(rawUrl);
  if (normalized === null) {
    return { code: "INVALID_ARGUMENT", message: t("error.INVALID_ARGUMENT", { command: "--url" }) };
  }
  const allowWrites = change.allowWrites ?? existing?.allowWrites ?? false;
  const grants = allowWrites && existing?.allowWrites !== true;
  const moves = allowWrites && existing !== undefined && normalized.url !== existing.url;
  if (mode === "agent" && (grants || moves)) {
    return { code: "HUMAN_REQUIRED", message: t("error.HUMAN_REQUIRED") };
  }
  return {
    defaultProfile: config.defaultProfile ?? name,
    profiles: { ...config.profiles, [name]: { url: normalized.url, allowWrites } },
  };
}
