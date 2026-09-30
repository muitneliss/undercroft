/**
 * An install that did not finish, in words: the one sentence for it, and what to show below.
 *
 * Shared by the wizard's install step and the tray's Start, so the same outcome reads the same
 * wherever a person meets it.
 */

import type { InstallOutcome } from "../rpc.ts";
import type { Translate } from "./index.ts";

export interface FailureWords {
  readonly message: string;
  /** Compose's last lines, or the health probe's error, verbatim; `null` when there is none. */
  readonly detail: string | null;
}

export function failureWords(
  t: Translate,
  failure: Exclude<InstallOutcome, { readonly ok: true }>,
): FailureWords {
  switch (failure.reason) {
    case "docker":
      return { message: t("install.failed.docker"), detail: null };
    case "invalid":
      return { message: t("install.failed.invalid"), detail: null };
    case "orphaned-data":
      return { message: t("install.failed.orphaned", { volume: failure.volume }), detail: null };
    case "step-failed":
      return { message: t("install.failed.step"), detail: failure.tail };
    case "unhealthy":
      return {
        message: t("install.failed.unhealthy", { error: failure.lastError }),
        detail: null,
      };
    case "no-install":
      return { message: t("install.failed.noInstall"), detail: null };
    default:
      return failure satisfies never;
  }
}
