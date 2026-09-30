/**
 * Where an install lives when a person has not said.
 *
 * One answer for every front end: the terminal wizard and the desktop app must find the SAME
 * install on a machine, or a person who installed with one and opens the other is offered a
 * second install beside the first -- whose `write` would then meet the first one's volume and
 * refuse it as `orphaned-data`.
 *
 * Per user, never system-wide, because the `.env` in it holds every secret and is readable by
 * its owner alone: the user's own local application data on Windows, a dot-folder in the home
 * directory elsewhere. The caller hands in the two values this depends on, because this package
 * reads no environment (ADR 0095).
 */

import { posix, win32 } from "node:path";
import type { Platform } from "./docker.ts";

export interface InstallDirInputs {
  /** The user's home directory. */
  readonly home: string;
  /** `%LOCALAPPDATA%`, which only Windows sets; `undefined` elsewhere. */
  readonly localAppData: string | undefined;
}

export function defaultInstallDir(platform: Platform, inputs: InstallDirInputs): string {
  if (platform === "win32") {
    return inputs.localAppData === undefined
      ? win32.join(inputs.home, ".undercroft")
      : win32.join(inputs.localAppData, "Undercroft");
  }
  return posix.join(inputs.home, ".undercroft");
}
