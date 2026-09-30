/**
 * The setup wizard's store: the one owner of its state (`.claude/rules/state.md`).
 *
 * There is no server-state cache in this app. The main process is asked over RPC (`bridge.ts`,
 * `commands.ts`) and its answers are recorded here by the actions below, so a component reads
 * one value from one place and a test drives the wizard without a main process. What the state
 * is lives in `wizard.ts`; when a person may move lives in `rules.ts`; this module only applies
 * those rules to the state, action by action.
 */

import type { Locale } from "@undercroft/core/locale";
import type { DockerState, Mode } from "@undercroft/setup";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Boot, DockerOffer, InstallEvent, InstallOutcome } from "../rpc.ts";
import { canAdvance, installAfter, stepAfter, stepBefore, stepForFailure } from "./rules.ts";
import {
  type ClientDraft,
  type Connector,
  type Draft,
  type DockerView,
  IDLE_INSTALL,
  initialState,
  NO_CLIENT,
  type WizardState,
} from "./wizard.ts";

export interface WizardActions {
  chooseLanguage: (locale: Locale) => void;
  chooseMode: (mode: Mode) => void;
  edit: (patch: Partial<Omit<Draft, Connector>>) => void;
  editConnector: (connector: Connector, patch: Partial<ClientDraft>) => void;
  dockerBusy: (busy: DockerView["busy"]) => void;
  dockerChecked: (state: DockerState, offer?: DockerOffer) => void;
  dockerInstallEnded: (outcome: { state: DockerState; restartNeeded: boolean }) => void;
  dockerRestartFailed: () => void;
  /** Move on when the current step has nothing wrong; else show what is. */
  next: () => void;
  back: () => void;
  skipConnectors: () => void;
  installStarted: () => void;
  installProgress: (event: InstallEvent) => void;
  installEnded: (outcome: InstallOutcome) => void;
}

export type Wizard = WizardState & WizardActions;
export type WizardStore = StoreApi<Wizard>;

type Set = WizardStore["setState"];
type Get = WizardStore["getState"];

function answerActions(
  set: Set,
): Pick<WizardActions, "chooseLanguage" | "chooseMode" | "edit" | "editConnector"> {
  return {
    chooseLanguage: (locale): void => set({ locale }),
    chooseMode: (mode): void => set({ mode, showProblems: false }),
    edit: (patch): void => set((state) => ({ draft: { ...state.draft, ...patch } })),
    editConnector: (connector, patch): void =>
      set((state) => ({
        draft: { ...state.draft, [connector]: { ...state.draft[connector], ...patch } },
      })),
  };
}

function dockerActions(
  set: Set,
): Pick<
  WizardActions,
  "dockerBusy" | "dockerChecked" | "dockerInstallEnded" | "dockerRestartFailed"
> {
  function docker(patch: (current: DockerView) => Partial<DockerView>): void {
    set((state) => ({ docker: { ...state.docker, ...patch(state.docker) } }));
  }
  return {
    dockerBusy: (busy): void => docker(() => ({ busy })),
    dockerChecked: (checked, offer): void =>
      docker((current) => ({ state: checked, offer: offer ?? current.offer, busy: null })),
    dockerInstallEnded: ({ state: checked, restartNeeded }): void =>
      docker(() => ({
        state: checked,
        busy: null,
        restartNeeded,
        installFailed: !restartNeeded && checked.state === "missing",
      })),
    dockerRestartFailed: (): void => docker(() => ({ restartFailed: true })),
  };
}

function navigation(set: Set, get: Get): Pick<WizardActions, "next" | "back" | "skipConnectors"> {
  return {
    next: (): void => {
      const state = get();
      set(
        canAdvance(state)
          ? { step: stepAfter(state.step), showProblems: false }
          : { showProblems: true },
      );
    },
    back: (): void => {
      const state = get();
      if (!state.install.running) {
        set({ step: stepBefore(state), showProblems: false });
      }
    },
    skipConnectors: (): void => {
      const state = get();
      if (state.step === "connectors") {
        set({
          draft: { ...state.draft, googleIngest: NO_CLIENT, xero: NO_CLIENT },
          step: stepAfter(state.step),
          showProblems: false,
        });
      }
    },
  };
}

function installActions(
  set: Set,
): Pick<WizardActions, "installStarted" | "installProgress" | "installEnded"> {
  return {
    installStarted: (): void => set({ install: { ...IDLE_INSTALL, running: true } }),
    installProgress: (event): void =>
      set((state) => ({ install: installAfter(state.install, event) })),
    installEnded: (outcome): void =>
      set((state) =>
        outcome.ok
          ? {
              install: { ...state.install, running: false, failure: null },
              step: "done",
              url: outcome.url,
              // Installed now: going back reaches settings and no further.
              reconfigure: true,
            }
          : {
              install: { ...state.install, running: false, failure: outcome },
              step: stepForFailure(outcome),
              showProblems: outcome.reason === "invalid",
            },
      ),
  };
}

export function createWizardStore(boot: Boot): WizardStore {
  return createStore<Wizard>()((set, get) => ({
    ...initialState(boot),
    ...answerActions(set),
    ...dockerActions(set),
    ...navigation(set, get),
    ...installActions(set),
  }));
}
