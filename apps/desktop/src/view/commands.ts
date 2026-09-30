/**
 * What the wizard's buttons do: ask the main process, then record its answer in the store.
 *
 * The store (`store.ts`) decides; this module only waits. Each command marks the store busy
 * where a person must see that something is happening, calls one request, and hands the answer
 * to the store action that owns it -- so the rules about steps stay in one place, testable
 * without a main process, and this module stays a list of round trips.
 */

import type { Locale } from "@undercroft/core/locale";
import type { BunApi, Link } from "../rpc.ts";
import { plan } from "./rules.ts";
import type { WizardStore } from "./store.ts";
import { answersOf } from "./wizard.ts";

export interface WizardCommands {
  chooseLanguage: (locale: Locale) => Promise<void>;
  checkDocker: () => Promise<void>;
  installDocker: () => Promise<void>;
  startDocker: () => Promise<void>;
  restartForDocker: () => Promise<void>;
  chooseFolder: () => Promise<void>;
  install: () => Promise<void>;
  openInstall: () => Promise<void>;
  openLink: (link: Link) => Promise<void>;
  close: () => Promise<void>;
}

export function wizardCommands(api: BunApi, store: WizardStore): WizardCommands {
  const state = store.getState;
  return {
    chooseLanguage: async (locale): Promise<void> => {
      state().chooseLanguage(locale);
      await api.setLocale({ locale });
    },
    checkDocker: async (): Promise<void> => {
      state().dockerBusy("checking");
      const [docker, offer] = await Promise.all([api.detectDocker({}), api.dockerOffer({})]);
      state().dockerChecked(docker, offer);
    },
    installDocker: async (): Promise<void> => {
      state().dockerBusy("installing");
      state().dockerInstallEnded(await api.installDocker({}));
    },
    startDocker: async (): Promise<void> => {
      state().dockerBusy("starting");
      state().dockerChecked(await api.startDocker({}));
    },
    restartForDocker: async (): Promise<void> => {
      const { ok } = await api.restartForDocker({ mode: state().mode });
      if (!ok) {
        state().dockerRestartFailed();
      }
    },
    chooseFolder: async (): Promise<void> => {
      const chosen = await api.chooseFolder({ current: state().draft.dir });
      if (chosen !== null) {
        state().edit({ dir: chosen });
      }
    },
    install: async (): Promise<void> => {
      const current = state();
      current.installStarted();
      const outcome = await api.install({ answers: answersOf(current), dir: plan(current).dir });
      state().installEnded(outcome);
    },
    openInstall: async (): Promise<void> => {
      await api.openInstall({});
    },
    openLink: async (link): Promise<void> => {
      await api.openLink({ link });
    },
    close: async (): Promise<void> => {
      await api.close({});
    },
  };
}
