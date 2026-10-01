/**
 * Whether one element fills the screen, and the way in and out of it.
 *
 * The browser owns this state -- Esc leaves full screen without asking anyone -- so it is read
 * from `document.fullscreenElement` on every `fullscreenchange`, never copied into the store,
 * where it would go stale the moment the reader pressed Esc (`.claude/rules/state.md`).
 */

import { type RefObject, useCallback, useSyncExternalStore } from "react";

function subscribe(change: () => void): () => void {
  document.addEventListener("fullscreenchange", change);
  return (): void => {
    document.removeEventListener("fullscreenchange", change);
  };
}

export function useFullscreen(target: RefObject<HTMLElement | null>): {
  /** False where the browser or an embedding frame refuses full screen: offer nothing. */
  available: boolean;
  on: boolean;
  toggle: () => void;
} {
  const on = useSyncExternalStore(
    subscribe,
    () => target.current !== null && document.fullscreenElement === target.current,
  );
  const toggle = useCallback((): void => {
    if (document.fullscreenElement === null) {
      // A refusal leaves the page as it was, which the reader sees; there is nothing to recover.
      void target.current?.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen();
    }
  }, [target]);
  return { available: document.fullscreenEnabled === true, on, toggle };
}
