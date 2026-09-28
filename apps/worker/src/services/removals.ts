/**
 * What a complete listing of one entity decides: which of its held records were removed at
 * source, which are live again -- and the same for every relation whose records hang off them.
 *
 * Whether a listing is complete is not decided here. `@undercroft/connector-runtime`'s
 * `listing.ts` hands one over only for a read that asked the source for everything and got to
 * the end, as the value that read returns. What is decided here is which STREAMS that listing
 * speaks for, which is the spec's to say:
 *
 * - the entity's own, declared `removedWhen: absent`;
 * - each `batch-from` relation declared `removedWhen: parent-removed` against it. Its records
 *   are keyed by the parent's id -- a HubSpot deal-to-company link is keyed by the deal -- so the
 *   parent's listing is its listing too: a link whose deal has gone is gone, and comes back
 *   when the deal does. That is decided now, with the parent, rather than when the relation is
 *   read: the relation reads only the parents that changed, so it could never say.
 *
 * Read from the spec as DECLARED rather than as a scope reads it, because a removal is a fact
 * about the source: a relation some scope leaves unread still loses its links with its deal.
 */

import type { ReadEnd } from "@undercroft/connector-runtime";
import type { ConnectorSpec } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import { reconcileRemovals, type StreamIdentity } from "../repos/rawRecords.ts";

/** The entity a listing is of, then every relation that is removed with it, in spec order. */
function streamsDecidedBy(spec: ConnectorSpec, entity: string): string[] {
  const relations = spec.entities.flatMap((e) =>
    e.removedWhen === "parent-removed" &&
    e.request.kind === "batch-from" &&
    e.request.entity === entity
      ? [e.name]
      : [],
  );
  return [entity, ...relations];
}

/**
 * Settle every stream a read of `listedOf.entity` decides, from what that read RETURNED -- or
 * nothing, which is the answer for a read that did not return (it threw or was stopped) and for
 * one whose listing is `null` (it could not say). Taking the runtime's `ReadEnd` rather than a
 * set is the point: an id set assembled any other way is the partial listing this whole area
 * exists to refuse.
 */
export async function settleRemovals(
  exec: SqlExecutor,
  spec: ConnectorSpec,
  listedOf: StreamIdentity,
  end: ReadEnd | undefined,
): Promise<void> {
  const listed = end?.listed ?? null;
  if (listed === null) {
    return;
  }
  for (const entity of streamsDecidedBy(spec, listedOf.entity)) {
    await reconcileRemovals(exec, { ...listedOf, entity }, listed);
  }
}
