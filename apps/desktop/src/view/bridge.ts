/**
 * The webview's end of the RPC, and the only view module that imports Electrobun.
 *
 * It answers nothing -- the main process has no requests for the view -- and it receives one
 * message, an install's progress, which it hands to whoever `onProgress` names. Everything else
 * in the view is written against `BunApi` (`rpc.ts`), so the offline gate typechecks it without
 * Electrobun's SDK and `task ci:desktop-check` checks this module against the real one.
 */

import { Electroview } from "electrobun/view";
import type { BunApi, DesktopRpc, InstallEvent } from "../rpc.ts";

let listener: (event: InstallEvent) => void = (): void => undefined;

const rpc = Electroview.defineRPC<DesktopRpc>({
  // An install waits minutes on pulls and health; the view waits as long as it takes.
  maxRequestTime: Number.POSITIVE_INFINITY,
  handlers: {
    requests: {},
    messages: {
      progress: (event): void => listener(event),
    },
  },
});

export const bridge = {
  api: rpc.request satisfies BunApi,
  view: new Electroview({ rpc }),
  onProgress: (next: (event: InstallEvent) => void): void => {
    listener = next;
  },
};
