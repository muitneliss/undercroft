---
title: 'ADR 0055: An open tab learns of a new release from a service worker'
type: source
date: 2026-09-25
tags: []
source: docs/adr/0055-an-open-tab-learns-of-a-new-release-from-a-service-worker.md
source_path: docs/adr/0055-an-open-tab-learns-of-a-new-release-from-a-service-worker.md
source_hash: ceed71d329a1108586141f71ab2d0a7c5f24f0904dfb912e52dbb879a53d1cc9
ingested: 2026-09-25
---

# ADR 0055: An open tab learns of a new release from a service worker

Accepted 2026-09-25.

**Problem.** A tab keeps the bundle it loaded. After a deploy, a tab left open is still the previous release calling the new control plane, and nothing told the reader to reload. The colophon (`lib/release.ts`) names the tab's own release but cannot know whether that is still the one being served. The signal has to stay quiet in a tab that loaded after the deploy, because a notice to reload into the same build gets ignored.

**Decision.** The build emits a release beacon: a service worker at `/sw.js` whose only content is the release tag. `vite.config.ts` writes it next to the bundle from the same stamp the bundle carries. The browser re-fetches a registered worker and fires `updatefound` on every open tab's registration when the bytes differ, and the beacon's bytes differ exactly when the release does.

* `main.tsx` registers it in a production build only. `lib/releaseWatch.ts` listens for `updatefound` and, once the new worker has activated, asks it for its release over a `MessageChannel`. An SPA never navigates, so the tab also calls `registration.update()` every five minutes while visible and whenever it becomes visible. Each check also asks the active worker, which covers a tab frozen while the update installed.
* The event is not the evidence; the answer is. `replacedBy` reports a release only when the worker answers with a tag that is not the tab's own. A first install, a tab loaded after the deploy, and an answer that is not a tag all show nothing. A different tag is reported either way, because a rollback leaves an open tab just as stale.
* The notice is client state: `liveRelease` in the store, written by the watcher and rendered by `ReleaseNotice` as a status slip fixed at the foot of every screen, with the tag and a Reload button. The reader presses Reload; an automatic reload would discard unsaved drafts.
* The worker intercepts nothing and caches nothing: no `fetch` listener, so it is never on a request's path, `/trpc` and sign-in included. It calls `skipWaiting`, because it holds nothing a tab depends on and a waiting worker would still be waiting after the reload it asked for.
* The control plane serves `/sw.js` with `no-cache`, like `index.html`. A worker's URL is its identity, so it cannot be hashed, and the static route's `immutable` for every other real file would pin the previous release's worker.

**Rejected.** Polling an endpoint or a static `release.json` for the server's release (it works, but the browser already has an update check for this, and the request was specifically for service worker update detection). A caching PWA worker via `vite-plugin-pwa` or Workbox (an offline copy of the app can outlive a deploy, which is the defect being reported, and a control plane is useless offline). Reloading automatically (loses unpersisted drafts). Showing the notice on `updatefound` alone (a tab loaded after the deploy would be told to reload into the build it already runs).

**Consequences.** The notice appears within five minutes of a deploy in a visible tab, or at once when a background tab is brought back, and only in a production build. A broken or missing beacon costs only the notice, and every registration, update or message failure is quiet. `sw.js` at the root of `dist` is a name the build and the server share, and `handlers/server.test.ts` pins that it is served revalidated.
