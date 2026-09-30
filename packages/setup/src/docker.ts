/**
 * Whether this machine can run the stack, and how to make it able to.
 *
 * Undercroft installs as a Docker compose stack (ADR 0095), so the first question is Docker's
 * state, and it has more than two answers. Each one is a different thing to tell a person:
 *
 *   - `missing`       -- no `docker` program. Offer to install it.
 *   - `no-permission` -- Linux, and this user is not in the `docker` group. Installing again
 *                        would not help; the runbook says what does.
 *   - `stopped`       -- installed, but the daemon does not answer. Docker Desktop is closed.
 *   - `no-compose`    -- a daemon, but no Compose v2 plugin. `docker-compose` v1 is not enough:
 *                        the stack relies on `depends_on: condition` and `--wait`.
 *   - `ready`
 *
 * Installing Docker is returned as a PLAN rather than done, because it is the one step that
 * changes the machine outside the install folder, needs an administrator, and is worth
 * showing a person before it runs. `installDocker` executes a plan only through the runner.
 */

import { NOT_FOUND, type Runner } from "./runner.ts";

export type DockerState =
  | { readonly state: "missing" }
  | { readonly state: "no-permission" }
  | { readonly state: "stopped" }
  | { readonly state: "no-compose" }
  | { readonly state: "ready"; readonly composeVersion: string };

/** `docker info` against a socket this user may not open says so in these words. */
const PERMISSION_DENIED = /permission denied/iu;

export async function detectDocker(run: Runner): Promise<DockerState> {
  const client = await run("docker", ["--version"]);
  if (client.code === NOT_FOUND) {
    return { state: "missing" };
  }
  const daemon = await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (daemon.code !== 0) {
    return PERMISSION_DENIED.test(daemon.stderr)
      ? { state: "no-permission" }
      : { state: "stopped" };
  }
  const compose = await run("docker", ["compose", "version", "--short"]);
  const composeVersion = compose.stdout.trim();
  if (compose.code !== 0 || composeVersion === "") {
    return { state: "no-compose" };
  }
  return { state: "ready", composeVersion };
}

export type Platform = "darwin" | "linux" | "win32";
export type Arch = "arm64" | "x64";

export interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

export interface DockerInstallPlan {
  /**
   * What installs Docker on this platform, run in the person's own terminal -- it may ask for
   * an administrator's password or a licence agreement. `null` where a person must download it.
   */
  readonly install: Command | null;
  /** Where a person installs it by hand, always given: the command above can be refused. */
  readonly manualUrl: string;
  /**
   * What starts the daemon once installed. Docker Desktop does not start itself after an
   * install; the Linux engine does (get.docker.com enables its service).
   */
  readonly start: Command | null;
}

const DESKTOP_DOCS = "https://docs.docker.com/desktop/";

/**
 * How Docker gets onto this machine. A pure answer: nothing is run here.
 *
 * - **Windows**: winget, which ships with Windows 10 1809+ and 11. Docker Desktop needs WSL 2,
 *   which its installer enables; a restart may follow.
 * - **macOS**: Homebrew's cask when Homebrew is present, else the download for this CPU.
 * - **Linux**: Docker's own convenience script, as root. It installs the engine and the
 *   Compose plugin from Docker's repository for the distribution it finds.
 */
export function dockerInstallPlan(
  platform: Platform,
  arch: Arch,
  options: { readonly hasBrew: boolean },
): DockerInstallPlan {
  switch (platform) {
    case "win32":
      return {
        install: {
          command: "winget",
          args: [
            "install",
            "--exact",
            "--id",
            "Docker.DockerDesktop",
            "--accept-package-agreements",
            "--accept-source-agreements",
          ],
        },
        manualUrl: `${DESKTOP_DOCS}setup/install/windows-install/`,
        start: {
          command: "cmd",
          args: ["/c", "start", "", "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"],
        },
      };
    case "darwin":
      return {
        install: options.hasBrew
          ? { command: "brew", args: ["install", "--cask", "docker"] }
          : null,
        manualUrl: `https://desktop.docker.com/mac/main/${arch === "arm64" ? "arm64" : "amd64"}/Docker.dmg`,
        start: { command: "open", args: ["-a", "Docker"] },
      };
    case "linux":
      return {
        install: { command: "sh", args: ["-c", "curl -fsSL https://get.docker.com | sudo sh"] },
        manualUrl: "https://docs.docker.com/engine/install/",
        start: null,
      };
    default:
      return platform satisfies never;
  }
}

/** Whether Homebrew is on this Mac, which decides the macOS plan. */
export async function hasBrew(run: Runner): Promise<boolean> {
  return (await run("brew", ["--version"])).code === 0;
}

/**
 * Run a plan's install, then its start, in the person's terminal. `true` when both exited 0;
 * `detectDocker` is still the judge of whether Docker is ready, since Docker Desktop takes a
 * while to bring its daemon up after `start` returns.
 */
export async function installDocker(run: Runner, plan: DockerInstallPlan): Promise<boolean> {
  if (plan.install === null) {
    return false;
  }
  const installed = await run(plan.install.command, plan.install.args, { interactive: true });
  if (installed.code !== 0) {
    return false;
  }
  if (plan.start === null) {
    return true;
  }
  return (await run(plan.start.command, plan.start.args, { interactive: true })).code === 0;
}
