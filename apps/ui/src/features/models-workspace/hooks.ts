import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useUiStore } from "@/store.ts";
import type { WorkspaceState } from "./types.ts";

export function useWorkspace(): WorkspaceState {
  return useUiStore((state) => state.modelsWorkspace);
}
export function patchWorkspace(
  patch: Parameters<ReturnType<typeof useUiStore.getState>["patchModelsWorkspace"]>[0],
): void {
  useUiStore.getState().patchModelsWorkspace(patch);
}
export function useNavigation() {
  const [params, setParams] = useSearchParams();
  return (changes: Record<string, string | null>, replace = false): void => {
    const next = new URLSearchParams(params);
    if (changes.model !== undefined && changes.model !== params.get("model")) {
      for (const key of ["shown", "expanded", "selection", "rp"]) {
        next.delete(key);
      }
      patchWorkspace({ quickModel: null, chooser: false, selected: [], layout: null });
    }
    setParams(searchWith(next, changes), { replace, preventScrollReset: true });
  };
}
export function useWords(): { t: TFunction; locale: Locale } {
  const { t } = useTranslation();
  return { t, locale: useUiStore((state) => state.locale) };
}

function subscribeWidth(notify: () => void): () => void {
  const media = globalThis.matchMedia("(max-width: 767px)");
  media.addEventListener("change", notify);
  return (): void => media.removeEventListener("change", notify);
}
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    subscribeWidth,
    () => globalThis.matchMedia("(max-width: 767px)").matches,
  );
}

export function searchWith(
  params: URLSearchParams,
  changes: Record<string, string | null>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  return next;
}
