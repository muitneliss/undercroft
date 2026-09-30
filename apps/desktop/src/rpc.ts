/**
 * What the wizard's webview and the app's main process say to each other (ADR 0097).
 *
 * Types only, and no Electrobun import: this module is the contract, and both sides are checked
 * against it. `main.ts` hands it to `BrowserView.defineRPC<DesktopRpc>` and `view/bridge.ts` to
 * `Electroview.defineRPC<DesktopRpc>`, and `task ci:desktop-check` typechecks both against the
 * real Electrobun SDK. The shape is Electrobun's `RPCSchema` written out, so the root gate can
 * typecheck everything that uses it without the SDK, which Electrobun 2 does not publish to npm.
 *
 * The view never runs a program, reads a file or opens a socket: it asks. Every request names a
 * decision the main process owns (`services/desktop.ts`), and the answers are values -- a Docker
 * state, a problem code, a phase -- that the view words in its reader's language.
 */

import type { Locale } from "@undercroft/core/locale";
import type { Answers, DockerState, Mode, Platform, Problem } from "@undercroft/setup";

/** Where the wizard picks up after Windows restarts to finish installing Docker. */
export interface Resume {
  readonly mode: Mode;
}

/** Everything the view needs before its first paint. */
export interface Boot {
  /** The release this app installs, `vX.Y.Z`: the images' tag. */
  readonly release: string;
  readonly platform: Platform;
  readonly locale: Locale;
  /** The install folder: the one this app installed to, else the default every front end uses. */
  readonly dir: string;
  /** The answers the install in `dir` was written with; `null` when there is none yet. */
  readonly existing: Answers | null;
  readonly resume: Resume | null;
}

/** How Docker gets onto this machine, as the view offers it. */
export interface DockerOffer {
  /**
   * The command that installs Docker, shown to a person; `null` where there is none and they
   * download it themselves.
   */
  readonly command: string | null;
  /**
   * Whether the app runs that command itself. Only where it needs no terminal: winget raises its
   * own elevation prompt, while `brew` and `sudo` would ask for a password on a terminal this
   * app does not have.
   */
  readonly runnable: boolean;
  readonly manualUrl: string;
  /** Docker Desktop's licence applies (macOS and Windows); Docker Engine on Linux has none. */
  readonly licence: boolean;
  /** Whether the app can open Docker when it is installed but stopped. */
  readonly canStart: boolean;
}

export interface DockerOutcome {
  readonly state: DockerState;
  /** Windows installed Docker and needs a restart before its daemon can run (WSL 2). */
  readonly restartNeeded: boolean;
}

export type InstallPhase = "writing" | "pulling" | "starting" | "waiting";

/** One image's pull, as Docker reports it. */
export type ImageState = "pulling" | "pulled" | "failed";

/** What the main process tells the view while an install runs. */
export type InstallEvent =
  | { readonly kind: "phase"; readonly phase: InstallPhase }
  | { readonly kind: "image"; readonly image: string; readonly state: ImageState }
  | { readonly kind: "line"; readonly line: string };

export type InstallOutcome =
  | { readonly ok: true; readonly url: string }
  /** Docker stopped answering between its step and this one. */
  | { readonly ok: false; readonly reason: "docker"; readonly state: DockerState }
  | { readonly ok: false; readonly reason: "invalid"; readonly problems: readonly Problem[] }
  | { readonly ok: false; readonly reason: "orphaned-data"; readonly volume: string }
  | {
      readonly ok: false;
      readonly reason: "step-failed";
      readonly phase: InstallPhase;
      readonly tail: string;
    }
  | { readonly ok: false; readonly reason: "unhealthy"; readonly lastError: string }
  /** No install to start: the folder holds no `.env`. */
  | { readonly ok: false; readonly reason: "no-install" };

export type Link = "googleIngestGuide" | "xeroGuide" | "dockerLicence" | "dockerDownload";

interface Request<P, R> {
  readonly params: P;
  readonly response: R;
}
type Empty = Record<string, never>;

export interface DesktopRpc {
  bun: {
    requests: {
      boot: Request<Empty, Boot>;
      detectDocker: Request<Empty, DockerState>;
      dockerOffer: Request<Empty, DockerOffer>;
      installDocker: Request<Empty, DockerOutcome>;
      startDocker: Request<Empty, DockerState>;
      /** Save the wizard's place, register a relaunch, and restart Windows. */
      restartForDocker: Request<{ readonly mode: Mode }, { readonly ok: boolean }>;
      chooseFolder: Request<{ readonly current: string }, string | null>;
      install: Request<{ readonly answers: Answers; readonly dir: string }, InstallOutcome>;
      /** Open what is installed in the browser, at exactly its public URL (ADR 0094). */
      openInstall: Request<Empty, boolean>;
      openLink: Request<{ readonly link: Link }, boolean>;
      setLocale: Request<{ readonly locale: Locale }, boolean>;
      /** The wizard is finished with: close its window, leave the tray. */
      close: Request<Empty, boolean>;
    };
    messages: Record<never, unknown>;
  };
  webview: {
    requests: Record<never, { params: unknown; response: unknown }>;
    messages: {
      progress: InstallEvent;
    };
  };
}

/** The requests the view may make, by name. */
export type BunRequests = DesktopRpc["bun"]["requests"];

/**
 * The requests as functions: what `handlers/requests.ts` implements in the main process, and
 * what `view/bridge.ts` hands the view to call.
 */
export type BunApi = {
  readonly [K in keyof BunRequests]: (
    params: BunRequests[K]["params"],
  ) => Promise<BunRequests[K]["response"]>;
};
