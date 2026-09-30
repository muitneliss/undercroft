/**
 * How a component reaches the wizard: its store, its commands, and its words.
 *
 * The store is built once, after the main process has answered `boot`, and handed down through
 * one React context -- the same "one instance, made once" idiom `apps/ui/src/main.tsx` uses for
 * its clients, and not a `useState` (`.claude/rules/state.md`). The words follow the store's
 * locale on every render, so choosing a language re-words the whole window at once.
 */

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { messages, type Translate } from "../i18n/index.ts";
import type { WizardCommands } from "./commands.ts";
import type { Wizard, WizardStore } from "./store.ts";

export interface WizardContextValue {
  readonly store: WizardStore;
  readonly commands: WizardCommands;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

function useWizardContext(): WizardContextValue {
  const value = useContext(WizardContext);
  if (value === null) {
    throw new Error("the wizard's components render inside WizardContext");
  }
  return value;
}

export function useWizard<T>(selector: (wizard: Wizard) => T): T {
  return useStore(useWizardContext().store, selector);
}

export function useCommands(): WizardCommands {
  return useWizardContext().commands;
}

export function useT(): Translate {
  return messages(useWizard((wizard) => wizard.locale));
}
