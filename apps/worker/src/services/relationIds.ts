/**
 * Which ids each `batch-from` relation of a spec run reads against, held only for the entities
 * some relation names.
 *
 * A relation -- HubSpot's links, keyed by the record they hang off -- is asked about the records
 * its parent's read NAMED, landed or skipped as unchanged, never only the ones that changed. A
 * record the client filter skipped still has links, and a relation added to a spec after its
 * parent's watermark was set would otherwise never learn the links of any record that has not
 * changed since (ADR 0075). The runtime hands the named ids back only when asked (`keepIds`), so
 * an entity nobody references never holds them.
 */

import type { ReadEnd, RunContext } from "@undercroft/connector-runtime";
import type { ConnectorEntity } from "@undercroft/contracts";

/**
 * The entities some `batch-from` relation actually reads against.
 *
 * Computed from the spec before the first request, so an entity nobody references never
 * builds an id list at all. Keeping every entity's ids to the end of the run was a second
 * copy of the source held for the benefit of a relation that, in both shipped specs,
 * references one entity out of four -- and it grew with the source, which is the shape this
 * whole change exists to remove.
 */
function referencedEntities(entities: readonly ConnectorEntity[]): ReadonlySet<string> {
  return new Set(
    entities.flatMap((entity) =>
      entity.request.kind === "batch-from" ? [entity.request.entity] : [],
    ),
  );
}

/** The entity a relation reads against, or `null` for an entity that is not a relation. */
export function parentOf(entity: ConnectorEntity): string | null {
  return entity.request.kind === "batch-from" ? entity.request.entity : null;
}

export class RelationIds {
  readonly #referenced: ReadonlySet<string>;
  readonly #ids = new Map<string, readonly string[]>();

  constructor(entities: readonly ConnectorEntity[]) {
    this.#referenced = referencedEntities(entities);
  }

  /**
   * The context to read `entity` in: a relation gets its parent's ids -- none, when the parent
   * named none -- and a parent is asked to keep the ids it names.
   */
  contextFor(entity: ConnectorEntity, ctx: RunContext): RunContext {
    const parent = parentOf(entity);
    return {
      ...ctx,
      ...(parent === null ? {} : { sourceIds: this.#ids.get(parent) ?? [] }),
      ...(this.#referenced.has(entity.name) ? { keepIds: true } : {}),
    };
  }

  /** Keep what a finished read of `entity` named, for the relations that read against it. */
  keep(entity: string, named: ReadEnd["named"]): void {
    if (this.#referenced.has(entity)) {
      this.#ids.set(entity, [...(named ?? [])]);
    }
  }
}
