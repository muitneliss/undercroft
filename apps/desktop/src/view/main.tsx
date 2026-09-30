/**
 * The webview's entry: ask the main process where things stand, build the store from its
 * answer, and render.
 *
 * The store is made once, here, after `boot` -- the language, the folder and any existing
 * install must be known before the first paint, or the window would flash a first step it then
 * skips. Progress messages from the main process go straight into the store.
 */

import { createRoot } from "react-dom/client";
import { bridge } from "./bridge.ts";
import { wizardCommands } from "./commands.ts";
import { WizardContext } from "./context.ts";
import { createWizardStore } from "./store.ts";
import { Wizard } from "./Wizard.tsx";

const store = createWizardStore(await bridge.api.boot({}));
bridge.onProgress((event) => store.getState().installProgress(event));
const commands = wizardCommands(bridge.api, store);

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <WizardContext value={{ store, commands }}>
      <Wizard />
    </WizardContext>,
  );
}
