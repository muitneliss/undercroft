/**
 * Recover a tab that a deploy has left asking for chunks that no longer exist.
 *
 * Every division, the editor and the charts load on demand, each from a file whose name is a
 * hash of its content. A release replaces the image, and with it every one of those files, so
 * a tab opened before the deploy asks for `Models-<old hash>.js` and the server has nothing by
 * that name. Vite's preload helper reports the failure as a `vite:preloadError` event on
 * `window` before rethrowing it, which is the one place the whole application can hear it.
 * Left unanswered, `React.lazy` throws it into the tree and the page goes blank. ADR 0070.
 *
 * A reload is the only cure -- it fetches the current `index.html`, which names the current
 * chunks -- and it is taken automatically only when it costs nothing. Unsaved drafts live in
 * the store and are deliberately not persisted (ADR 0055), so a tab that holds one keeps it,
 * and `StaleChunkBoundary` shows the reader why the page did not open and the Reload that
 * fixes it. A reload also records when it happened, in `sessionStorage`: a chunk that is still
 * missing straight after one is not missing because of a deploy, and reloading again would
 * loop. A tab that cannot record it does not reload at all, for the same reason.
 *
 * The event's error is never swallowed. `preventDefault` would resolve the import to
 * `undefined`, which fails later and less legibly in `routeTable.tsx`; instead every failure
 * reaches the boundary, which recognises it by identity rather than by reading a message that
 * each browser words differently.
 */

/** Where the last automatic reload is recorded, as milliseconds since the epoch. */
const RELOADED_AT = "undercroft.staleChunkReloadedAt";

/**
 * How long after a reload another stale chunk is taken as a real failure rather than a
 * deploy. A reloaded tab is on the current release, so a chunk missing within this window
 * would be missing again after a second reload.
 */
const SETTLE_MS = 60_000;

/** The failures `vite:preloadError` reported, by identity. See the module docstring. */
const staleChunks = new WeakSet<object>();

export type ChunkRecovery = "reload" | "keep";

export interface ChunkRecoveryDeps {
  /** Whether a reload would discard something the server does not hold. */
  readonly hasUnsavedWork: () => boolean;
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly now: () => number;
  readonly reload: () => void;
}

/** Whether `error` is a chunk load that `vite:preloadError` reported. */
export function isStaleChunk(error: unknown): boolean {
  return typeof error === "object" && error !== null && staleChunks.has(error);
}

/** The last reload's time, `null` for none, or `undefined` when it cannot be read. */
function lastReload(storage: ChunkRecoveryDeps["storage"]): number | null | undefined {
  let held: string | null;
  try {
    held = storage.getItem(RELOADED_AT);
  } catch {
    return;
  }
  if (held === null) {
    return null;
  }
  const at = Number.parseInt(held, 10);
  return Number.isNaN(at) ? undefined : at;
}

function recordReload(storage: ChunkRecoveryDeps["storage"], at: number): boolean {
  try {
    storage.setItem(RELOADED_AT, String(at));
    return true;
  } catch {
    return false;
  }
}

/** Mark `error` as a stale chunk, then reload the tab if that loses nothing and cannot loop. */
export function recoverStaleChunk(error: unknown, deps: ChunkRecoveryDeps): ChunkRecovery {
  if (typeof error === "object" && error !== null) {
    staleChunks.add(error);
  }
  if (deps.hasUnsavedWork()) {
    return "keep";
  }
  const now = deps.now();
  const last = lastReload(deps.storage);
  if (last === undefined || (last !== null && now - last < SETTLE_MS)) {
    return "keep";
  }
  if (!recordReload(deps.storage, now)) {
    return "keep";
  }
  deps.reload();
  return "reload";
}

/** Answer every `vite:preloadError` on `target`. Called once, from `main.tsx`. */
export function recoverFromStaleChunks(target: EventTarget, deps: ChunkRecoveryDeps): void {
  target.addEventListener("vite:preloadError", (event) => {
    // Narrowed rather than cast: the listener is typed as a bare `Event` on an `EventTarget`,
    // and the payload is whatever the failed import rejected with.
    recoverStaleChunk("payload" in event ? event.payload : undefined, deps);
  });
}
