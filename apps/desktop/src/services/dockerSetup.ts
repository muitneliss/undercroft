/**
 * Getting Docker ready from a window, where the setup package's plan assumes a terminal.
 *
 * `@undercroft/setup` knows how Docker gets onto each platform (`dockerInstallPlan`) and what
 * state it is in (`detectDocker`). Its plan is written to run in a person's terminal, where
 * `brew` and `sudo` can ask for a password. This app has no terminal, so:
 *
 * - **Only winget runs here.** It raises Windows' own elevation prompt. On macOS and Linux the
 *   command is shown for a person to run, beside the download link.
 * - **Windows then needs a restart.** A successful winget install puts `docker` on the system
 *   PATH and turns on WSL 2, neither of which this running process can see until Windows
 *   restarts. So the wizard saves its place, registers itself to open once after the restart
 *   (`RunOnce`), and restarts when the person says so.
 * - **The detector stays the judge.** Whatever an install or a start reported, the state
 *   afterwards is what `detectDocker` says, polled while Docker Desktop brings its daemon up.
 */

import type { Clock } from "@undercroft/core";
import {
  type Arch,
  type DockerInstallPlan,
  type DockerState,
  detectDocker,
  dockerInstallPlan,
  hasBrew,
  type Mode,
  type Platform,
  type Runner,
} from "@undercroft/setup";
import type { DockerOffer, DockerOutcome } from "../rpc.ts";
import type { Prefs } from "./prefs.ts";

export interface DockerSetupDeps {
  readonly run: Runner;
  readonly clock: Clock;
  readonly platform: Platform;
  readonly arch: Arch;
  readonly prefs: Prefs;
  /** Where the installer's own lines are kept, for the tray's Logs folder. */
  readonly log: (line: string) => void;
  /** The program that opens this app, which Windows runs once after the restart. */
  readonly relaunchCommand: string;
}

export interface DockerSetup {
  detect: () => Promise<DockerState>;
  offer: () => Promise<DockerOffer>;
  /** Install Docker where the app can (Windows), then wait for its daemon. */
  install: () => Promise<DockerOutcome>;
  /** Open an installed Docker, then wait for its daemon. */
  start: () => Promise<DockerState>;
  /** Save the wizard's place, register a relaunch and restart Windows. `false` if refused. */
  restartForDocker: (mode: Mode) => Promise<boolean>;
}

const POLL_MS = 3000;
/** Docker Desktop's first start, which unpacks its VM, takes a minute or two. */
const START_TIMEOUT_MS = 300_000;
const RUN_ONCE = ["HKCU", "Software", "Microsoft", "Windows", "CurrentVersion", "RunOnce"].join(
  "\\",
);
/** Seconds Windows waits before restarting, so the window can say what is happening. */
const RESTART_DELAY_SECONDS = "10";

class GuiDockerSetup implements DockerSetup {
  readonly #deps: DockerSetupDeps;

  constructor(deps: DockerSetupDeps) {
    this.#deps = deps;
  }

  readonly detect = (): Promise<DockerState> => detectDocker(this.#deps.run);

  readonly offer = async (): Promise<DockerOffer> => {
    const { platform } = this.#deps;
    const chosen = await this.#plan();
    const { install } = chosen;
    return {
      command: install === null ? null : [install.command, ...install.args].join(" "),
      runnable: platform === "win32" && install !== null,
      manualUrl: chosen.manualUrl,
      licence: platform !== "linux",
      canStart: chosen.start !== null,
    };
  };

  readonly install = async (): Promise<DockerOutcome> => {
    const chosen = await this.#plan();
    if (this.#deps.platform !== "win32" || chosen.install === null) {
      return { state: await this.detect(), restartNeeded: false };
    }
    const installed = await this.#deps.run(chosen.install.command, chosen.install.args, {
      onLine: this.#deps.log,
    });
    const state = await this.#startDaemon(chosen);
    // Only the exit code tells "installed, restart to finish" from "not installed": either way
    // this process still finds no `docker` until Windows restarts.
    return { state, restartNeeded: installed.code === 0 && state.state !== "ready" };
  };

  readonly start = async (): Promise<DockerState> => await this.#startDaemon(await this.#plan());

  readonly restartForDocker = async (mode: Mode): Promise<boolean> => {
    const { run, platform, prefs, relaunchCommand } = this.#deps;
    if (platform !== "win32") {
      return false;
    }
    await prefs.update({ resume: { mode } });
    const register = ["add", RUN_ONCE, "/v", "Undercroft", "/t", "REG_SZ", "/d"];
    const registered = await run("reg", [...register, relaunchCommand, "/f"]);
    return (
      registered.code === 0 &&
      (await run("shutdown", ["/r", "/t", RESTART_DELAY_SECONDS])).code === 0
    );
  };

  async #plan(): Promise<DockerInstallPlan> {
    const { platform, arch, run } = this.#deps;
    return dockerInstallPlan(platform, arch, {
      hasBrew: platform === "darwin" && (await hasBrew(run)),
    });
  }

  async #startDaemon(chosen: DockerInstallPlan): Promise<DockerState> {
    if (chosen.start !== null) {
      await this.#deps.run(chosen.start.command, chosen.start.args);
    }
    const { clock } = this.#deps;
    const deadline = clock.now().getTime() + START_TIMEOUT_MS;
    let state = await this.detect();
    while (state.state === "stopped" && clock.now().getTime() < deadline) {
      await clock.sleep(POLL_MS);
      state = await this.detect();
    }
    return state;
  }
}

export function dockerSetup(deps: DockerSetupDeps): DockerSetup {
  return new GuiDockerSetup(deps);
}
