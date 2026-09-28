/**
 * Which of a spec source's lists a connection reads, and which of them its recorded grant cannot.
 *
 * Two processes need this answer and neither may own it alone, for the reason `googleGrant.ts`
 * gives for Google's one scope. The worker asks it before a run's first request (`openSpecRun`),
 * and reads the first half and names each list of the second as not granted. The control plane
 * asks it to say, on the card, whether the connection can run at all and which lists a reconnect
 * would add (`presentStatus`). One rule here, so the card cannot promise a list the run skips, or
 * call a connection lapsed that the run still reads from.
 *
 * Each list's scope is the spec's own `readScope`, written once beside the entity it governs; this
 * module holds no scope of any provider. ADR 0073 for the run, ADR 0074 for the card.
 */

import type { ConnectionScope } from "./connectionScope.ts";
import type { ConnectorEntity } from "./connectorSpec.ts";

/** A list the recorded grant cannot read, and the scope a reconnect would add for it. */
export interface UngrantedRead {
  readonly entity: string;
  readonly scope: string;
}

/**
 * Split the lists a connection would read into those its recorded grant reaches and those it does
 * not, in spec order.
 *
 * The admin's choice narrows the list first: a Xero scope naming entities reads those, and an
 * empty one reads every entity, as `XeroScope` records it. No choice at all -- a connection nobody
 * has scoped yet -- reads the spec as written, which is also what every other scope does to the
 * list. So a list nobody chose is never named as missing.
 *
 * An entity with no `readScope` is read on any grant: the spec contract requires one of every
 * entity whose consent names scopes, so an entity without one has no scope to lack. An EMPTY
 * recorded grant judges nothing and reads everything, for the reason `missingReadScope` gives:
 * nothing recorded is no evidence of a narrow grant. The provider then answers for itself.
 */
export function partitionByGrant<E extends Pick<ConnectorEntity, "name" | "readScope">>(
  entities: readonly E[],
  connection: { readonly scope: ConnectionScope | null; readonly grantedScope: string },
): { granted: E[]; ungranted: UngrantedRead[] } {
  const { scope, grantedScope } = connection;
  const chosen =
    scope?.kind === "xero" && scope.entities.length > 0
      ? entities.filter((entity) => scope.entities.includes(entity.name))
      : entities;

  const granted: E[] = [];
  const ungranted: UngrantedRead[] = [];
  const held = new Set(grantedScope.split(" ").filter((name) => name !== ""));
  for (const entity of chosen) {
    if (held.size === 0 || entity.readScope === undefined || held.has(entity.readScope)) {
      granted.push(entity);
    } else {
      ungranted.push({ entity: entity.name, scope: entity.readScope });
    }
  }
  return { granted, ungranted };
}
