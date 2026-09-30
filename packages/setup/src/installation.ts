/**
 * One install of Undercroft: a folder holding a `.env` and a compose file, and the Docker
 * compose project that runs from it (ADR 0095).
 *
 * This is the only owner of installing, and it knows nothing about who is asking. The terminal
 * wizard calls it today and the GUI wizard will call the same object; each hands in how to run
 * a program, how to fetch, and a clock, and gets back values -- never a sentence, never an exit.
 *
 * ## The promise that matters most: a re-run keeps the secrets
 *
 * `write` generates a secret only for a name the install does not already hold. The Postgres
 * and MinIO volumes were initialised with the old passwords, and `UNDERCROFT_SECRET_KEY` sealed
 * every stored token; replacing either loses access to data that still exists. So a re-run
 * rewrites only what the ANSWERS decide -- mode, port, URL, sign-in, connectors, release -- and
 * every other line of the `.env`, including what a person added by hand, stays.
 *
 * The same reasoning refuses the mirror case. A folder with no `.env` beside a Postgres volume
 * from an earlier install means the secrets for that data are gone; generating new ones would
 * start a stack that cannot open its own database. `write` answers `orphaned-data` and leaves
 * the choice -- restore the `.env`, or uninstall the data -- to a person.
 */

import { chmod, mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "@undercroft/core";
import { type Answers, installUrl, type Problem, validateAnswers } from "./answers.ts";
import { COMPOSE_FILE, PROJECT } from "./composeFile.ts";
import { parseStatus, type ServiceStatus, type StepResult, step } from "./composeOutput.ts";
import { parseEnv, updateEnv } from "./envFile.ts";
import type { RunOptions, RunResult, Runner } from "./runner.ts";
import { generateSecrets, SECRET_NAMES } from "./secrets.ts";
import { answersFrom, ENV_HEADER, localOrigin, settingsFor } from "./settings.ts";

export type Fetch = (url: string, init?: { readonly signal?: AbortSignal }) => Promise<Response>;

export interface InstallationDeps {
  /** The install folder. Created on first write; nothing outside it is written. */
  readonly dir: string;
  readonly run: Runner;
  readonly fetch: Fetch;
  readonly clock: Clock;
}

export type WriteResult =
  | { readonly ok: true; readonly url: string; readonly firstInstall: boolean }
  | { readonly ok: false; readonly reason: "invalid"; readonly problems: readonly Problem[] }
  | { readonly ok: false; readonly reason: "orphaned-data"; readonly volume: string };

export type HealthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly lastError: string };

export interface Installation {
  /** Validate `answers` and write the install folder. Touches no container. */
  write: (answers: Answers) => Promise<WriteResult>;
  /**
   * The answers the install in this folder was written with, or `null` when there is none. What
   * a re-run starts from, so changing one answer does not clear the others.
   */
  read: () => Promise<Answers | null>;
  pull: (onLine: (line: string) => void) => Promise<StepResult>;
  up: (onLine: (line: string) => void) => Promise<StepResult>;
  /** Poll the control plane's health endpoint until it answers or `timeoutMs` passes. */
  waitHealthy: (timeoutMs: number) => Promise<HealthResult>;
  /** Every service's state, or `null` when compose could not say. */
  status: () => Promise<ServiceStatus[] | null>;
  /** Follow the stack's log in this terminal until the person stops it. */
  logs: (service: string | null) => Promise<StepResult>;
  down: () => Promise<StepResult>;
  /**
   * Remove the containers. With `keepData` the volumes, `.env` and compose file stay, so a later
   * `up` brings back the same data. Without it the volumes go too, then the two
   * files this package wrote; the folder is removed only if that leaves it empty. With no `.env`
   * here, it removes the volumes an earlier install left behind -- the way out of
   * `orphaned-data`.
   */
  uninstall: (options: { readonly keepData: boolean }) => Promise<StepResult>;
}

export const ENV_FILE = ".env";
export const COMPOSE_FILE_NAME = "docker-compose.yml";

/** The volume whose presence means an earlier install's data is still on this machine. */
const DATA_VOLUME = `${PROJECT}_postgres-data`;
const HEALTH_PATH = "/api/health";
const POLL_MS = 2000;
const REQUEST_TIMEOUT_MS = 5000;
/** Kestra is a JVM and takes a minute; a first start on a slow disk takes several. */
const UP_WAIT_SECONDS = "900";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

/** Write `text` so that no reader ever sees half of it, readable by this user alone. */
async function writePrivate(path: string, text: string): Promise<void> {
  const staging = `${path}.tmp`;
  await writeFile(staging, text, { mode: 0o600 });
  // `mode` above is filtered by the umask; chmod is not. On Windows both are no-ops, and the
  // file inherits the user profile's ACL, which already excludes other users.
  await chmod(staging, 0o600);
  await rename(staging, path);
}

class ComposeInstallation implements Installation {
  readonly #deps: InstallationDeps;
  readonly #envPath: string;
  readonly #composePath: string;

  constructor(deps: InstallationDeps) {
    this.#deps = deps;
    this.#envPath = join(deps.dir, ENV_FILE);
    this.#composePath = join(deps.dir, COMPOSE_FILE_NAME);
  }

  readonly read = async (): Promise<Answers | null> => {
    const text = await readText(this.#envPath);
    return text === null ? null : answersFrom(parseEnv(text));
  };

  readonly write = async (answers: Answers): Promise<WriteResult> => {
    const problems = validateAnswers(answers);
    if (problems.length > 0) {
      return { ok: false, reason: "invalid", problems };
    }
    const existing = await readText(this.#envPath);
    if (
      existing === null &&
      (await this.#deps.run("docker", ["volume", "inspect", DATA_VOLUME])).code === 0
    ) {
      return { ok: false, reason: "orphaned-data", volume: DATA_VOLUME };
    }
    const held = parseEnv(existing ?? "");
    const fresh = generateSecrets();
    const secrets = SECRET_NAMES.filter((name) => (held.get(name) ?? "") === "").map(
      (name): [string, string] => [name, fresh[name]],
    );
    const values = new Map([...secrets, ...settingsFor(answers, held)]);
    await mkdir(this.#deps.dir, { recursive: true, mode: 0o700 });
    await writePrivate(this.#envPath, updateEnv(existing ?? ENV_HEADER, values));
    await writeFile(this.#composePath, COMPOSE_FILE);
    return { ok: true, url: installUrl(answers), firstInstall: existing === null };
  };

  readonly pull = async (onLine: (line: string) => void): Promise<StepResult> =>
    step(await this.#compose(["pull"], { onLine }));

  readonly up = async (onLine: (line: string) => void): Promise<StepResult> => {
    const args = [
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      UP_WAIT_SECONDS,
      "--remove-orphans",
    ];
    return step(await this.#compose(args, { onLine }));
  };

  readonly waitHealthy = async (timeoutMs: number): Promise<HealthResult> => {
    const answers = await this.read();
    if (answers === null) {
      return { ok: false, lastError: "no install" };
    }
    const url = `${localOrigin(answers)}${HEALTH_PATH}`;
    const { clock } = this.#deps;
    const started = clock.now().getTime();
    for (;;) {
      const lastError = await this.#probe(url);
      if (lastError === null) {
        return { ok: true };
      }
      if (clock.now().getTime() - started >= timeoutMs) {
        return { ok: false, lastError };
      }
      await clock.sleep(POLL_MS);
    }
  };

  readonly status = async (): Promise<ServiceStatus[] | null> => {
    const result = await this.#compose(["ps", "--all", "--format", "json"]);
    return result.code === 0 ? parseStatus(result.stdout) : null;
  };

  readonly logs = async (service: string | null): Promise<StepResult> => {
    const args = ["logs", "--follow", "--tail", "200", ...(service === null ? [] : [service])];
    return step(await this.#compose(args, { interactive: true }));
  };

  readonly down = async (): Promise<StepResult> => step(await this.#compose(["down"]));

  readonly uninstall = async ({
    keepData,
  }: {
    readonly keepData: boolean;
  }): Promise<StepResult> => {
    if ((await readText(this.#envPath)) === null) {
      return keepData ? { ok: true } : await this.#removeOrphanedVolumes();
    }
    // Images are left in Docker's cache: `postgres`, `kestra` and the rest are shared with
    // whatever else runs on this machine, and removing a cache another project uses is not an
    // uninstall's business. The runbook says how to reclaim the space.
    const args = keepData ? ["down"] : ["down", "--volumes"];
    const result = step(await this.#compose([...args, "--remove-orphans"]));
    if (!result.ok || keepData) {
      return result;
    }
    await rm(this.#envPath, { force: true });
    await rm(this.#composePath, { force: true });
    // Only when empty: `--dir` may name a folder that holds other things of the person's.
    await rmdir(this.#deps.dir).catch((): void => undefined);
    return result;
  };

  /** `null` when the endpoint answered 2xx, else what went wrong, for the timeout's sentence. */
  async #probe(url: string): Promise<string | null> {
    try {
      const response = await this.#deps.fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok ? null : `HTTP ${response.status}`;
    } catch (error) {
      return error instanceof Error ? error.message : "no answer";
    }
  }

  #compose(args: readonly string[], options?: RunOptions): Promise<RunResult> {
    const { dir } = this.#deps;
    const files = [
      "--project-directory",
      dir,
      "--file",
      this.#composePath,
      "--env-file",
      this.#envPath,
    ];
    return this.#deps.run("docker", ["compose", ...files, "--ansi", "never", ...args], options);
  }

  /**
   * An earlier install's volumes with no `.env` left to run its compose file (`orphaned-data`).
   * Found by compose's own project label rather than by name, so a volume a later release adds
   * is found too.
   */
  async #removeOrphanedVolumes(): Promise<StepResult> {
    const label = `label=com.docker.compose.project=${PROJECT}`;
    const listed = await this.#deps.run("docker", ["volume", "ls", "--quiet", "--filter", label]);
    const volumes = listed.stdout.split("\n").filter((name) => name.trim() !== "");
    if (listed.code !== 0 || volumes.length === 0) {
      return step(listed);
    }
    return step(await this.#deps.run("docker", ["volume", "rm", ...volumes]));
  }
}

export function installation(deps: InstallationDeps): Installation {
  return new ComposeInstallation(deps);
}
