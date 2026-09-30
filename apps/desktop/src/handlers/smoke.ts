/**
 * The CI smoke walk: the packaged app, driven through its first three steps with nobody at it.
 *
 * `task ci:desktop-check` launches the built app with `UNDERCROFT_DESKTOP_SMOKE=<file>`. The
 * wizard boots as it would for a person; once it has, the walk presses the forward button twice
 * -- Language, then Mode -- which brings the Docker step on screen, and the Docker step checks
 * Docker by itself. When that check reaches the main process, the walk writes what Docker said
 * to the file and quits.
 *
 * So one file proves what no unit test can: that the view bundle loads in the system webview,
 * React mounts, the RPC answers both ways, the step machine advances, and the Docker step asks
 * the real detector -- in the artifact a person downloads. Which state Docker reports does not
 * matter here (a macOS runner has no Docker; an Ubuntu one does); that the step asked does.
 */

import type { BunApi } from "../rpc.ts";

/** Press the wizard's forward button, then press it again once the next step has rendered. */
const WALK = `
  document.querySelector(".button--go")?.click();
  setTimeout(() => document.querySelector(".button--go")?.click(), 400);
`;

export interface SmokeDeps {
  /** Run script in the wizard's webview. */
  readonly script: (js: string) => void;
  /** Record the walk's result where the check reads it. */
  readonly report: (line: string) => void;
  readonly quit: () => void;
}

/** How long the window stays up after the walk ends, so a person running it can see it. */
const LINGER_MS = 3000;
/** Time for the first step to render after `boot` answers. */
const RENDER_MS = 500;

export function smokeWalk(handlers: BunApi, deps: SmokeDeps): BunApi {
  return {
    ...handlers,
    boot: async (params): ReturnType<BunApi["boot"]> => {
      const booted = await handlers.boot(params);
      setTimeout(() => deps.script(WALK), RENDER_MS);
      return booted;
    },
    detectDocker: async (params): ReturnType<BunApi["detectDocker"]> => {
      const state = await handlers.detectDocker(params);
      deps.report(`ok docker=${state.state}`);
      setTimeout(deps.quit, LINGER_MS);
      return state;
    },
  };
}
