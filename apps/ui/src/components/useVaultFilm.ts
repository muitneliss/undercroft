/** Mounts the cover's vault film on the landing page's own elements; `@/lib/vault/runtime.ts`. */

import { type RefObject, useEffect, useRef } from "react";

import { type Reel, VaultFilm, type VaultWords } from "@/lib/vault/runtime.ts";
import { useUiStore } from "@/store.ts";

export interface VaultRefs {
  readonly page: RefObject<HTMLDivElement | null>;
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly band: RefObject<HTMLDivElement | null>;
  readonly stages: RefObject<HTMLOListElement | null>;
  readonly steps: RefObject<HTMLOListElement | null>;
}

/**
 * Starts the film on mount (and again when the words change language), and stops it on unmount.
 *
 * The reader's own pause (`filmHeld`) is handed to the running reel rather than listed as a
 * dependency of the start, because restarting the film to pause it would rewind the vault to
 * its opening frame -- the reader asked for it to stand where it is.
 */
export function useVaultFilm(refs: VaultRefs, words: VaultWords): void {
  const held = useUiStore((state) => state.filmHeld);
  const reelRef = useRef<Reel | null>(null);

  useEffect(() => {
    const page = refs.page.current;
    const canvas = refs.canvas.current;
    const band = refs.band.current;
    const stages = refs.stages.current;
    const steps = refs.steps.current;
    if (page === null || canvas === null || band === null || stages === null || steps === null) {
      return;
    }
    const started = VaultFilm.start(
      { page, canvas, band, stages, steps },
      words,
      useUiStore.getState().filmHeld,
    );
    reelRef.current = started;
    return (): void => {
      started?.stop();
      reelRef.current = null;
    };
  }, [refs, words]);

  useEffect(() => {
    reelRef.current?.hold(held);
  }, [held]);
}
