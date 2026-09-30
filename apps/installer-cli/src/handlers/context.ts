/**
 * Everything a command needs from the process, built once in `main.ts` and handed down, so no
 * handler reads argv, the environment or the platform for itself (`layering.md`).
 */

import type { Clock } from "@undercroft/core";
import type { Locale } from "@undercroft/core/locale";
import type { Arch, Installation, Platform, Runner } from "@undercroft/setup";
import type { Translate } from "../i18n/index.ts";
import type { Invocation } from "../services/options.ts";

export interface Context {
  readonly t: Translate;
  readonly locale: Locale;
  /** Whether a person is at the terminal. False under `--yes` and with no TTY. */
  readonly interactive: boolean;
  readonly invocation: Invocation;
  readonly install: Installation;
  /** The install folder, for the sentences that name it. */
  readonly dir: string;
  readonly run: Runner;
  /** Waiting for Docker Desktop to come up, without a timer of its own. */
  readonly clock: Clock;
  readonly platform: Platform;
  readonly arch: Arch;
  /** The installer's release, `vX.Y.Z`: the images it installs unless `--tag` says otherwise. */
  readonly release: string;
  /** Re-word everything from here on in `locale`: the wizard's first question is the language. */
  readonly relocale: (locale: Locale) => Context;
}

/** A command's exit code. */
export type Exit = 0 | 1;
