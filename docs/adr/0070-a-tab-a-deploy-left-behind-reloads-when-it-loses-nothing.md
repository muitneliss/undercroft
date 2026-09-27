# 70. A tab a deploy left behind reloads when it loses nothing

- Status: Accepted
- Date: 2026-09-27
- Amends: ADR 0055, on "Reload automatically when the worker changes"

## Context

Every division, the SQL editor, the charts and the interleaf are `React.lazy` chunks. Each is
a file under `/assets/` whose name is a hash of its content. A release replaces the image, and
with it every one of those files. A tab opened before the deploy still runs the old bundle, and
the first time it opens a division it has not loaded yet, it asks for a file the new image does
not have.

In production this showed up on `/tenants/<id>/models` as:

- `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server
responded with a MIME type of "text/html"`, and
- `Uncaught TypeError: Failed to fetch dynamically imported module: …/assets/Models-DLhr83qc.js`.

Two things turned a missing file into a blank page:

- **The server answered the miss with the app shell.** The SPA catch-all serves `index.html`
  for any path that is not a file, which is right for a deep link and wrong for `/assets/`. The
  browser got a 200 of HTML under a script URL and reported a MIME type, which reads like a
  broken server rather than a stale tab.
- **Nothing in the UI caught the failure.** `React.lazy` threw the rejected import into the
  tree. With no error boundary, React unmounted the whole application: the tab rail, the running
  head and everything else. Only F5 recovered it.

ADR 0055's notice does not cover this. It appears within five minutes of a deploy, and a reader
can open a division sooner than that. Once the tree has unmounted, the notice's Reload is gone
with it.

## Decision

**A miss under `/assets/` is a 404.** `handlers/server.ts` answers it before falling back to
the shell. Nothing under `/assets/` is a route. The directory is the build's own, and a name
missing from it is a chunk from another release.

**The tab listens for `vite:preloadError`** (`lib/staleChunk.ts`, registered in `main.tsx`).
Vite's preload helper dispatches it on `window` when a dynamic import or its preloaded CSS
fails, with the rejected error as `payload`. It does this before rethrowing, and it does so in
Vite 6.0.3 even for a chunk with no dependencies (`baseModule().catch(handlePreloadError)`).
Vite's documentation recommends answering it with a reload, which fetches the current
`index.html` and so the current chunk names.

**It reloads only when that loses nothing and cannot loop:**

- **Unsaved work keeps the tab.** `holdsUnsavedWork` in `store.ts` counts a model, question
  or dashboard draft that differs from its saved copy, an unsent assistant sentence and a cron
  being written. It also counts a scope selection or a lake console query simply by being held,
  because those are seeded from the server and the stream with no saved copy to compare. This
  keeps ADR 0055's reason for rejecting automatic reloads: drafts live only in memory.
- **A reload is recorded in `sessionStorage`,** and another stale chunk within a minute of one
  keeps the tab. A reloaded tab is on the current release, so a chunk still missing is missing
  for another reason, and reloading again would loop. If the tab cannot write or read the
  record, it does not reload at all.

**The error is never swallowed.** The listener does not call `preventDefault`, which would
resolve the import to `undefined` and fail later in `routeTable.tsx`. It records the error's
identity instead. `StaleChunkBoundary`, placed around the leaf and the interleaf in `Book.tsx`,
answers a failure it recognises by that identity. It shows an errata slip with the reason and a
Reload, while the rest of the book keeps working so the draft can be saved first. Any other
error it throws on unchanged, so a crashing page is not dressed up as a new release. The
boundary sits inside the keyed leaf, so turning to another division clears it.

## Options rejected

- **Reload on every `vite:preloadError`.** This is Vite's own example. It discards a
  half-written model, the case ADR 0055 refused. With no guard, it also reloads forever when a
  chunk is missing for a reason a reload does not fix: offline, an extension blocking it, or a
  broken build.
- **A notice and a Reload button only, never an automatic reload.** It keeps every draft, but a
  reader who has written nothing still has to press a button to open the page they asked for.
  The notice is now the fallback, not the only path.
- **Keep the previous release's assets in the image.** Old chunks would then never go missing.
  But every image would have to carry, or fetch, the build before it, and the release pipeline
  would need somewhere to keep them. That is a real cost for a failure a reload already cures.
- **Recognise the failure by its message.** Chrome, Firefox and Safari word a failed module
  import differently, and none of the wordings is a contract. The identity of the error Vite
  reported is exact.
- **Serve `index.html` for a missing asset and leave the UI alone.** That is the defect.

## Consequences

- A tab open across a deploy, holding nothing unsaved, opens the division it was asked for
  after a single reload, with no notice and no F5.
- A tab holding unsaved work shows the errata slip on the leaf, not a blank page. Its other
  divisions still open, because their chunks are either already loaded or equally recoverable.
- `StaleChunkBoundary` is the one class component in the UI. `useReactFunctionComponents` is
  switched off for that file alone in `biome.jsonc`, with the reason.
- A genuinely missing chunk that a reload does not fix fails once into the slip, not into a
  loop.
