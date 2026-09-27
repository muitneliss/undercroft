---
title: ADR 0070 A Tab A Deploy Left Behind Reloads When It Loses Nothing
type: source
date: 2026-09-27
tags: []
source: docs/adr/0070-a-tab-a-deploy-left-behind-reloads-when-it-loses-nothing.md
source_path: docs/adr/0070-a-tab-a-deploy-left-behind-reloads-when-it-loses-nothing.md
source_hash: 8db8666e202fa0f8f6c1b3a077aaa4dd1baea72dfd6d39b22afa6c305aad2ea8
ingested: 2026-09-27
---

# ADR 0070 A Tab A Deploy Left Behind Reloads When It Loses Nothing

# ADR 0070 A Tab A Deploy Left Behind Reloads When It Loses Nothing

Status: Accepted, 2026-09-27. Amends [[ADR 0055 An Open Tab Learns Of A New Release From A Service Worker]] on its rejection of automatic reloads.

## Context

Every division, the SQL editor, the charts and the interleaf are `React.lazy` chunks under `/assets/`, named by a content hash. A release replaces the image and every one of those files. A tab opened before the deploy asks for a chunk the new image lacks. In production (`/tenants/<id>/models`) the browser reported a MIME-type refusal and `Failed to fetch dynamically imported module`, and the whole app went blank until F5.

Two causes: the SPA catch-all in `handlers/server.ts` answered the missing asset with `index.html` (a 200 of HTML under a script URL), and no error boundary caught the rejected lazy import, so React unmounted the entire tree. ADR 0055's release notice arrives within five minutes and disappears with the tree.

## Decision

* **A miss under `/assets/` is a 404**, answered before the shell fallback. Nothing under `/assets/` is a route.
* **The tab listens for `vite:preloadError`** (`apps/ui/src/lib/staleChunk.ts`, registered in `main.tsx`). Vite's preload helper dispatches it on `window` with the rejected error as `payload` before rethrowing, even for a chunk with no dependencies (verified in Vite 6.0.3).
* **It reloads only when that loses nothing and cannot loop.** `holdsUnsavedWork` in `store.ts` counts dirty model/question/dashboard drafts, an unsent assistant sentence, a cron being written, and any held scope selection or lake console query (those have no saved copy to compare, so holding one counts). A reload is recorded in `sessionStorage`; another stale chunk within a minute keeps the tab; storage that cannot be read or written means no reload.
* **The error is never swallowed** (no `preventDefault`, which would resolve the import to `undefined`). Its identity is recorded, and `StaleChunkBoundary` around the leaf and the interleaf in `Book.tsx` answers only that failure with an errata slip and a Reload, leaving the rest of the book working so a draft can be saved. Any other error is rethrown unchanged. The boundary sits in the keyed leaf, so changing division clears it.

## Options rejected

* Reload on every `vite:preloadError` (Vite's own example): discards drafts and loops on a chunk missing for another reason.
* Notice and button only: a reader with nothing to lose still has to press a button.
* Keep the previous release's assets in the image: real pipeline cost for a failure a reload cures.
* Recognise the failure by its message: browsers word it differently; the error's identity is exact.
* Leave the server serving `index.html` for a missing asset: that is the defect.

## Consequences

A tab with nothing unsaved opens the division after one reload. A tab with unsaved work shows the slip on the leaf, not a blank page. `StaleChunkBoundary` is the UI's one class component; `useReactFunctionComponents` is off for that file alone in `biome.jsonc`, with the reason. A chunk still missing after a reload fails once into the slip, never into a loop.
