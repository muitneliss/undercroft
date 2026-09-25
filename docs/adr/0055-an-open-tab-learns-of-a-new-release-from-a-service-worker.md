# 55. An open tab learns of a new release from a service worker

- Status: Accepted
- Date: 2026-09-25

## Context

A tab keeps the bundle it loaded. After a release deploys, a tab left open is still the
previous release, calling the new control plane through a router whose shapes may have
changed, until somebody reloads it. Nothing told them to. The colophon names the tab's
release (`lib/release.ts`), but only the release it was built from, and it cannot know
whether that is still the one being served.

What is needed is a signal, in a tab that is already open, that the release the server serves
is no longer the one the tab runs. The signal also has to stay quiet in the tab that loaded
after the deploy. That tab is already current, and a notice to reload into the same build is
one people learn to ignore.

## Decision

**The build emits a release beacon: a service worker at `/sw.js` whose only content is the
release tag.** `vite.config.ts` writes it next to the bundle, from the same stamp the bundle
carries. The browser re-fetches a registered worker's script when it checks for an update, and
it fires `updatefound` on every open tab's registration when the bytes differ. The beacon's
bytes differ exactly when the release does.

- **`main.tsx` registers it in a production build.** `lib/releaseWatch.ts` listens for
  `updatefound`. When the new worker has activated, the tab asks it for its release over a
  `MessageChannel`. An SPA never navigates, so the tab also calls `registration.update()` every
  five minutes while visible, and whenever it becomes visible. Each check also asks the
  _active_ worker, which covers a tab that was frozen while the update installed.
- **The event is not the evidence; the answer is.** `replacedBy` reports a release only when
  the worker answers with a tag and that tag is not the tab's own. A first install, and a tab
  loaded after the deploy, both hear their own release and show nothing. An answer that is not
  a tag also shows nothing. A different tag is reported whichever way it points, because a
  rollback leaves an open tab exactly as stale.
- **The notice is client state.** `liveRelease` in the store is written by the watcher, and
  `ReleaseNotice` renders it: a status slip fixed at the foot of every screen, with the tag and
  a Reload button. The reader presses Reload. A tab that reloaded itself would discard a
  half-written model or question without asking.
- **The worker intercepts nothing and caches nothing.** It has no `fetch` listener, so it is
  never on the path of a request, `/trpc` and sign-in included. It calls `skipWaiting`
  because it holds nothing a running tab depends on. If it were left waiting, it would still
  be waiting after the reload it asked for.
- **The control plane serves `/sw.js` with `no-cache`**, as it does `index.html`. A worker's
  URL is its identity, so it cannot be hashed. Without this, the static route's `immutable`
  for every other real file would pin the previous release's worker in any cache in between.

## Options rejected

- **Poll an endpoint for the server's release.** This is a procedure, or a static
  `release.json`, compared against the stamp. It works. But the browser already has an update
  check for exactly this, one that runs on navigation and survives across tabs. The endpoint
  would also be a second channel for a fact the bundle already carries. The request was
  specifically to use the service worker's update detection.
- **A caching (PWA) service worker, via `vite-plugin-pwa` or Workbox.** An offline cache of the
  app is a second copy of it that can outlive a deploy, which is the defect this exists to
  report. It also adds a dependency and a precache manifest to maintain, and it gains nothing:
  a control plane is useless offline.
- **Reload automatically when the worker changes.** Unsaved drafts live in the store and are
  deliberately not persisted, so an automatic reload loses them.
- **Show the notice on `updatefound` alone.** A tab loaded after the deploy can hear the event
  for the same new worker, and it would be told to reload into the build it already runs.

## Consequences

- The notice appears within five minutes of a deploy in a visible tab, or at once when a
  background tab is brought back. It appears only in a production build: `vite serve` emits
  no beacon, and hot reload already keeps a development tab current.
- Nothing is intercepted, so a broken or missing beacon costs exactly the notice and nothing
  else. Registration, update and message failures are all quiet.
- `sw.js` at the root of `dist` is now a name the build and the server share.
  `handlers/server.test.ts` pins that it is served revalidated.
