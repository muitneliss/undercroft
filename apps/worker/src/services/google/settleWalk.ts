/**
 * What is only decidable once a whole harvest has been walked: what was removed at source,
 * and the refusal owed to each pick.
 *
 * Split out of `collect.ts` when removal began settling more than one stream (ADR 0078). It is
 * called only for a walk that reached its end; a stopped walk has no summary, and settling one
 * would report every file it had not reached as deleted (ADR 0051, ADR 0056).
 */

import type { SqlExecutor } from "@undercroft/db";

import { tombstoneMissing } from "../../repos/rawDocuments.ts";
import { reconcileRemovals } from "../../repos/rawRecords.ts";
import type { RefusalWriter } from "../landing.ts";
import type { HarvestSummary } from "./harvest.ts";

/**
 * Settle a finished walk. Answers how many documents were tombstoned.
 *
 * Removal is DRIVE'S ALONE and skipped when `listings` is null. A Gmail message that stops
 * matching a label selection has been relabelled, not deleted, and a removal would report a
 * deletion that never happened. It also runs only once every row is written, because each
 * sweep negates the ids this run named -- a row written after it would look like one nobody
 * saw.
 *
 * Each listed stream is settled by the same `reconcileRemovals` a spec entity is (ADR 0071),
 * so a folder dragged out of the pick is removed exactly like a file, and one dragged back is
 * live again. The record entity's listing also tombstones its documents, which are the same
 * ids. ADR 0078.
 *
 * A pick's refusal comes last for the same reason it comes at all: it is a statement about
 * the whole pick, and there is no such thing until the pick is exhausted.
 */
export async function settleWalk(
  exec: SqlExecutor,
  at: {
    readonly entity: string;
    readonly observedAt: string;
    readonly scoped: { readonly source: string; readonly tenantId: string };
    readonly refuse: RefusalWriter;
  },
  summary: HarvestSummary,
): Promise<number> {
  let tombstoned = 0;
  for (const [entity, ids] of summary.listings ?? []) {
    await reconcileRemovals(exec, { ...at.scoped, entity }, new Set(ids));
    if (entity === at.entity) {
      tombstoned = await tombstoneMissing(exec, at.scoped, {
        keptIds: ids,
        observedAt: at.observedAt,
      });
    }
  }

  for (const pick of summary.skipped) {
    await at.refuse([{ entity: at.entity, sourceRecordId: pick.fileId, reason: pick.reason }]);
  }

  return tombstoned;
}
