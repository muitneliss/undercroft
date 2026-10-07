/**
 * The title page's scene for this minute, and the reading behind it when the reader asked for one.
 *
 * Nothing here holds a value of its own (`.claude/rules/state.md`): the consent is the store's
 * (`weatherWanted`), the reading is the query cache's -- server data, even though the server is
 * Open-Meteo -- and the minute is the browser's clock, read through `useSyncExternalStore`
 * rather than copied anywhere.
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { locate, type Reading, readWeather, type Scene, sceneOf } from "@/lib/weather.ts";
import { useUiStore } from "@/store.ts";

const MINUTE = 60_000;
/** Weather changes on the scale of a quarter hour; asking more often only spends a free quota. */
const FRESH_FOR = 15 * MINUTE;

function subscribeMinute(change: () => void): () => void {
  const id = setInterval(change, MINUTE);
  return (): void => {
    clearInterval(id);
  };
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE);
}

async function readHere(): Promise<Reading> {
  const where = await locate(globalThis.navigator?.geolocation);
  return readWeather(globalThis.fetch.bind(globalThis), where);
}

export interface TitleWeather {
  readonly scene: Scene;
  readonly now: Date;
  readonly wanted: boolean;
  readonly reading: UseQueryResult<Reading>;
}

export function useTitleWeather(): TitleWeather {
  const minute = useSyncExternalStore(subscribeMinute, currentMinute);
  const wanted = useUiStore((state) => state.weatherWanted);
  const reading = useQuery({
    queryKey: ["title-weather"],
    queryFn: readHere,
    enabled: wanted,
    retry: false,
    staleTime: FRESH_FOR,
    refetchInterval: FRESH_FOR,
    refetchOnWindowFocus: false,
  });
  const now = new Date(minute * MINUTE);
  // A reading still in the cache after the reader withdrew consent is not drawn.
  const scene = sceneOf(now, wanted ? (reading.data ?? null) : null);
  return { scene, now, wanted, reading };
}
