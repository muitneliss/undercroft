/**
 * What the lineage board's cards and wires read as they render: the graph, the selection, the
 * last builds, and the way to select. `LineageCanvas` provides it; `LineageCards` reads it.
 *
 * WHY A CONTEXT. The board is handed its cards once, as `defaultNodes`, and owns them from then
 * on -- that is what lets a reader drag one -- so the selection cannot be written into them. A
 * card and a wire read it from here as they render instead, and the selection itself stays in
 * the address: one value in one place.
 */

import { createContext, useContext } from "react";

import type { ModelItem, ModelLineage } from "@/api/types.ts";
import type { Focus } from "@/lib/lineage.ts";

export interface BoardState {
  readonly graph: ModelLineage;
  readonly focus: Focus;
  /** Every model's list row, by name; empty until `models.list` answers. */
  readonly builds: ReadonlyMap<string, ModelItem>;
  /** Select a node by name, or clear the selection with `null`. */
  readonly select: (name: string | null) => void;
}

export const BoardContext = createContext<BoardState | null>(null);

export function useBoard(): BoardState {
  const board = useContext(BoardContext);
  if (board === null) {
    throw new Error("A lineage card rendered outside its board");
  }
  return board;
}
