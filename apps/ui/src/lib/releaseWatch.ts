/**
 * Tell this tab when a deploy has replaced the bundle it is running.
 *
 * Registers the release beacon (`vite.config.ts`) and listens for `updatefound`, which the
 * browser fires on every open tab's registration when it installs a worker whose bytes
 * differ -- and the beacon's bytes differ exactly when the release does. The new worker is
 * then ASKED which release it is, and the answer goes through `replacedBy`: the event alone
 * is not evidence, because a tab that loaded after the deploy sees the same event for the
 * same new worker, and telling it to reload would reload it into the build it already has.
 * ADR 0055.
 *
 * The browser checks a worker on navigation, and an SPA does not navigate, so the check is
 * also asked for on a timer and whenever the tab comes back into view. Each check also asks
 * the ACTIVE worker, which covers a tab that was frozen in the background while the update
 * installed and so never heard the event.
 *
 * Every failure is quiet on purpose. A refused registration, an update check that could not
 * reach the server, a worker that does not answer: each leaves the notice unshown, which is
 * what the tab would have looked like before this existed. It never shows the notice on a
 * guess.
 */

import { replacedBy } from "@/lib/release.ts";
import { useUiStore } from "@/store.ts";

/** How often a visible tab asks whether a new release is live. A deploy is not an alarm. */
const CHECK_EVERY_MS = 5 * 60_000;

/** Where the build emits the beacon. Its URL is its identity: see `vite.config.ts`. */
const BEACON_URL = "/sw.js";

/** Ask a worker which release it was built from. Resolves with whatever it answers. */
function askRelease(worker: ServiceWorker): Promise<unknown> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.addEventListener("message", (event) => resolve(event.data), { once: true });
    channel.port1.start();
    worker.postMessage(null, [channel.port2]);
  });
}

async function compare(worker: ServiceWorker | null): Promise<void> {
  if (worker === null) {
    return;
  }
  const release = replacedBy(await askRelease(worker));
  if (release !== null) {
    useUiStore.getState().noticeRelease(release);
  }
}

/** Ask the browser to re-check the beacon, then ask whichever worker is active. */
function check(registration: ServiceWorkerRegistration): void {
  if (document.visibilityState !== "visible") {
    return;
  }
  registration
    .update()
    .then(() => compare(registration.active))
    .catch(() => undefined);
}

function watch(registration: ServiceWorkerRegistration): void {
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        compare(worker).catch(() => undefined);
      }
    });
  });

  setInterval(() => check(registration), CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => check(registration));
}

/** Start watching. Called once, from `main.tsx`, in a production build only. */
export function watchForRelease(container: ServiceWorkerContainer): void {
  container
    .register(BEACON_URL)
    .then(watch)
    .catch(() => undefined);
}
