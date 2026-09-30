/**
 * The install this desktop app looks after, as decisions over `@undercroft/setup` (ADR 0098).
 *
 * The setup package owns every install decision -- secrets, the `.env`, the compose file,
 * `orphaned-data`, health -- and this service adds only what a window and a tray need on top:
 *
 * - **Where the install is.** The folder a person chose is remembered (`prefs.ts`), so the next
 *   launch finds it; with none remembered it is the default every front end shares
 *   (`defaultInstallDir`), so an install the terminal wizard wrote is found here too.
 * - **One compose operation at a time.** The wizard and the tray both reach this service; a
 *   `Stop` clicked while an install is pulling would race it. Every operation that runs compose
 *   waits for the one before it.
 * - **Progress as values.** Each line compose prints goes to the install log and to the caller,
 *   and a line that reports an image is read into that image's state (`pullProgress.ts`).
 * - **Docker is asked first.** An install or a start with no daemon answers `docker` at once,
 *   rather than failing a pull minutes later.
 *
 * Starting an install always moves it to this app's release, as the terminal wizard does: every
 * write lays down this app's compose file, and the images must come from the same release.
 * Getting Docker itself ready is `dockerSetup.ts`.
 */

import type { Clock } from "@undercroft/core";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core/locale";
import {
  type Answers,
  detectDocker,
  type Fetch,
  type Installation,
  installation,
  type Platform,
  type Runner,
  type ServiceStatus,
  type StepResult,
} from "@undercroft/setup";
import type { Boot, InstallEvent, InstallOutcome, InstallPhase } from "../rpc.ts";
import type { Prefs } from "./prefs.ts";
import { imageLine } from "./pullProgress.ts";

export interface DesktopDeps {
  readonly run: Runner;
  readonly fetch: Fetch;
  readonly clock: Clock;
  readonly platform: Platform;
  /** This app's release, `vX.Y.Z`: the images it installs. */
  readonly release: string;
  /** The install folder when none is remembered. */
  readonly defaultDir: string;
  readonly prefs: Prefs;
  /** Every line an install prints, kept for the tray's Logs folder. */
  readonly log: (line: string) => void;
}

/** Where the install is, and what it was written with (`null` when nothing is installed). */
export interface Installed {
  readonly dir: string;
  readonly answers: Answers | null;
}

type OnEvent = (event: InstallEvent) => void;
type Failure = Exclude<InstallOutcome, { readonly ok: true }>;

export interface Desktop {
  boot: () => Promise<Boot>;
  installed: () => Promise<Installed>;
  setLocale: (locale: Locale) => Promise<void>;
  /** Write `answers` into `dir`, pull, start and wait until the control plane answers. */
  install: (answers: Answers, dir: string, onEvent: OnEvent) => Promise<InstallOutcome>;
  /** Start what is installed, at this app's release. */
  start: (onEvent: OnEvent) => Promise<InstallOutcome>;
  /** `null` when nothing is installed. */
  stop: () => Promise<StepResult | null>;
  status: () => Promise<ServiceStatus[] | null>;
  /** `null` when nothing is installed. */
  uninstall: (keepData: boolean) => Promise<StepResult | null>;
}

/** How long a first start may take before the wizard stops waiting and points at the log. */
const HEALTH_TIMEOUT_MS = 600_000;

/** Write the install folder; a refusal becomes the outcome the view words. */
async function write(
  target: Installation,
  answers: Answers,
): Promise<{ readonly ok: true; readonly url: string } | Failure> {
  const written = await target.write(answers);
  if (written.ok) {
    return { ok: true, url: written.url };
  }
  return written.reason === "invalid"
    ? { ok: false, reason: "invalid", problems: written.problems }
    : { ok: false, reason: "orphaned-data", volume: written.volume };
}

/** Each line compose prints, to the log and the caller, and read for an image's progress. */
function lineReader(log: (line: string) => void, onEvent: OnEvent): (line: string) => void {
  return (line) => {
    const trimmed = line.trim();
    if (trimmed === "") {
      return;
    }
    log(trimmed);
    onEvent({ kind: "line", line: trimmed });
    const image = imageLine(trimmed);
    if (image !== null) {
      onEvent({ kind: "image", ...image });
    }
  };
}

function stepFailure(phase: InstallPhase, result: StepResult): Failure | null {
  return result.ok ? null : { ok: false, reason: "step-failed", phase, tail: result.tail };
}

/** Pull when asked, start, and wait until the control plane answers. */
async function launch(
  target: Installation,
  options: {
    readonly pull: boolean;
    readonly url: string;
    readonly onLine: (line: string) => void;
  },
  onEvent: OnEvent,
): Promise<InstallOutcome> {
  if (options.pull) {
    onEvent({ kind: "phase", phase: "pulling" });
    const pulled = stepFailure("pulling", await target.pull(options.onLine));
    if (pulled !== null) {
      return pulled;
    }
  }
  onEvent({ kind: "phase", phase: "starting" });
  const started = stepFailure("starting", await target.up(options.onLine));
  if (started !== null) {
    return started;
  }
  onEvent({ kind: "phase", phase: "waiting" });
  const health = await target.waitHealthy(HEALTH_TIMEOUT_MS);
  return health.ok
    ? { ok: true, url: options.url }
    : { ok: false, reason: "unhealthy", lastError: health.lastError };
}

class DesktopService implements Desktop {
  readonly #deps: DesktopDeps;
  /** The compose operation running now; the next one starts when it settles. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: DesktopDeps) {
    this.#deps = deps;
  }

  readonly boot = async (): Promise<Boot> => {
    const { prefs } = this.#deps;
    const remembered = await prefs.read();
    const { dir, answers } = await this.installed();
    if (remembered.resume !== undefined) {
      // Once: a person who closes the resumed wizard starts afresh next time.
      await prefs.update({ resume: undefined });
    }
    return {
      release: this.#deps.release,
      platform: this.#deps.platform,
      locale: remembered.locale ?? DEFAULT_LOCALE,
      dir,
      existing: answers,
      resume: remembered.resume ?? null,
    };
  };

  readonly installed = async (): Promise<Installed> => {
    const dir = (await this.#deps.prefs.read()).dir ?? this.#deps.defaultDir;
    return { dir, answers: await this.#at(dir).read() };
  };

  readonly setLocale = async (locale: Locale): Promise<void> => {
    await this.#deps.prefs.update({ locale });
  };

  readonly install = (answers: Answers, dir: string, onEvent: OnEvent): Promise<InstallOutcome> =>
    this.#serially(() => this.#writeAndLaunch(dir, answers, true, onEvent));

  readonly start = (onEvent: OnEvent): Promise<InstallOutcome> =>
    this.#serially(async () => {
      const { dir, answers } = await this.installed();
      if (answers === null) {
        return { ok: false, reason: "no-install" };
      }
      const { release } = this.#deps;
      const moving = answers.imageTag !== release;
      return await this.#writeAndLaunch(dir, { ...answers, imageTag: release }, moving, onEvent);
    });

  readonly stop = (): Promise<StepResult | null> =>
    this.#serially(async () => {
      const { dir, answers } = await this.installed();
      return answers === null ? null : await this.#at(dir).down();
    });

  readonly status = async (): Promise<ServiceStatus[] | null> =>
    await this.#at((await this.installed()).dir).status();

  readonly uninstall = (keepData: boolean): Promise<StepResult | null> =>
    this.#serially(async () => {
      const { dir, answers } = await this.installed();
      if (answers === null) {
        return null;
      }
      const result = await this.#at(dir).uninstall({ keepData });
      if (result.ok && !keepData) {
        await this.#deps.prefs.update({ dir: undefined });
      }
      return result;
    });

  #at(dir: string): Installation {
    const { run, fetch, clock } = this.#deps;
    return installation({ dir, run, fetch, clock });
  }

  /** Write, then launch -- the shared tail of an install and a start. */
  async #writeAndLaunch(
    dir: string,
    answers: Answers,
    pull: boolean,
    onEvent: OnEvent,
  ): Promise<InstallOutcome> {
    const docker = await detectDocker(this.#deps.run);
    if (docker.state !== "ready") {
      return { ok: false, reason: "docker", state: docker };
    }
    const target = this.#at(dir);
    onEvent({ kind: "phase", phase: "writing" });
    const written = await write(target, answers);
    if (!written.ok) {
      return written;
    }
    // Remembered once written, so a failed pull still leaves the install findable.
    await this.#deps.prefs.update({ dir });
    const onLine = lineReader(this.#deps.log, onEvent);
    return await launch(target, { pull, url: written.url, onLine }, onEvent);
  }

  /** Run `operation` once the compose operation before it has settled, however it ended. */
  #serially<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch((): void => undefined);
    return next;
  }
}

export function desktopService(deps: DesktopDeps): Desktop {
  return new DesktopService(deps);
}
