/** Mounts the cover's vault film on the landing page's own elements; `@/lib/vault/runtime.ts`. */

import { type RefObject, useEffect } from "react";

import { VaultFilm, type VaultWords } from "@/lib/vault/runtime.ts";

export interface VaultRefs {
  readonly cover: RefObject<HTMLDivElement | null>;
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly band: RefObject<HTMLDivElement | null>;
  readonly stages: RefObject<HTMLOListElement | null>;
  readonly steps: RefObject<HTMLOListElement | null>;
}

/** Starts the film on mount (and again when the words change language), and stops it on unmount. */
export function useVaultFilm(refs: VaultRefs, words: VaultWords): void {
  useEffect(() => {
    const cover = refs.cover.current;
    const canvas = refs.canvas.current;
    const band = refs.band.current;
    const stages = refs.stages.current;
    const steps = refs.steps.current;
    if (cover === null || canvas === null || band === null || stages === null || steps === null) {
      return;
    }
    const stop = VaultFilm.start({ cover, canvas, band, stages, steps }, words);
    return stop ?? undefined;
  }, [refs, words]);
}
