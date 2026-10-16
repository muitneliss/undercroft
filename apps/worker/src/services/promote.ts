/**
 * Publishing what a build proved: moving each promotable relation from the tenant's staging
 * schema into analytics, where the BI login reads, as one transaction (ADR 0131).
 *
 * WHICH is decided by `promotable` (`@undercroft/db/services`) from the build's steps and its
 * manifest. This module adds the one fact only the catalogue knows: a VIEW outside the build that
 * reads the version a node would replace. Postgres would refuse to drop that version (RESTRICT,
 * never CASCADE -- ADR 0077: publishing one model must not delete another), so the node is held
 * back instead, and the decision is asked again without it, because its children in the build
 * read its staging rows and must be held with it.
 *
 * HOW, for each node promoted, all inside one transaction on the tenant's dbt login, which owns
 * both schemas and everything in them:
 *
 * 1. Drop the version standing in analytics, and anything in STAGING that reads it -- a view a
 *    held build left there, scratch nobody publishes. Dependents first, so every drop is
 *    RESTRICT and a dependency nobody foresaw raises rather than cascades.
 * 2. `ALTER ... SET SCHEMA` the staging relation into analytics. Its rows are not copied, its
 *    own grant to the BI login travels with it (`010_provision_tenant.sql` gives it one as dbt
 *    creates it), and a promoted view over a promoted table follows the table, because a view
 *    refers to what it reads by identity.
 *
 * Before either, each of the customer's SCOPE LOGINS (ADR 0142) is granted SELECT on the staged
 * tables it reaches, and that grant travels too: a republished table is never, at any instant a
 * reader can see, ungranted to a scope that should read it or granted to one that should not.
 * It is the first thing the transaction does after reading the catalogue, because it takes the
 * customer's scope lock, and taking it after a DROP's lock could make a new scope's first grants
 * and this promotion wait for each other.
 *
 * A failure part-way rolls the whole promotion back: analytics stays exactly as it was, every
 * node is held, and the caller says so. Nothing in analytics is ever dropped except in the
 * transaction that moves its replacement in.
 */

import type { SqlExecutor } from "@undercroft/db";
import type { RunStep } from "@undercroft/db/repos";
import { buildGraph, promotable } from "@undercroft/db/services";

import {
  dependentsOf,
  dropRelation,
  grantStagedToScopes,
  inTransaction,
  moveRelation,
  type Relation,
  relationsIn,
} from "../repos/relations.ts";
import type { TenantSessions } from "./tenantSession.ts";

export interface PromotionTarget {
  readonly tenantId: string;
  readonly stagingSchema: string;
  readonly analyticsSchema: string;
}

export interface PromotionOutcome {
  /** The nodes now published in analytics, by name. */
  readonly promoted: ReadonlySet<string>;
  /** Nodes held back because a view outside the build reads their published version. */
  readonly heldByViews: ReadonlyMap<string, readonly string[]>;
}

function keyOf(relation: Pick<Relation, "schema" | "name">): string {
  return `${relation.schema}.${relation.name}`;
}

function byName(relations: readonly Relation[], schema: string): Map<string, Relation> {
  return new Map(relations.filter((r) => r.schema === schema).map((r) => [r.name, r]));
}

/**
 * Publish what `decide` allows, holding back what a view outside the build pins, and answer
 * with what was published. `decide` is handed the names held so far and answers the names to
 * promote; it is asked again each time this holds one more.
 */
export function promote(
  sessions: TenantSessions,
  target: PromotionTarget,
  decide: (held: ReadonlySet<string>) => ReadonlySet<string>,
): Promise<PromotionOutcome> {
  return sessions.as({ tenantId: target.tenantId, kind: "dbt" }, (exec) =>
    inTransaction(exec, async () => {
      const present = await relationsIn(exec, [target.stagingSchema, target.analyticsSchema]);
      const staged = byName(present, target.stagingSchema);
      const published = byName(present, target.analyticsSchema);
      const { chosen, heldByViews } = await settle({ exec, target, staged, published }, decide);
      await grantStagedToScopes(exec, [...chosen].sort());
      await dropReplaced(
        exec,
        target,
        [...chosen].flatMap((name) => published.get(name) ?? []),
        new Set([...chosen].map((name) => keyOf({ schema: target.stagingSchema, name }))),
      );
      for (const name of [...chosen].sort()) {
        const relation = staged.get(name);
        if (relation !== undefined) {
          await moveRelation(exec, relation, target.analyticsSchema);
        }
      }
      return { promoted: chosen, heldByViews };
    }),
  );
}

/**
 * The names to promote once every node a view outside the build pins is held. A node with no
 * relation in staging -- dbt reported it built and left nothing, as for an ephemeral model --
 * has nothing to publish and is held too.
 */
async function settle(
  catalogue: {
    readonly exec: SqlExecutor;
    readonly target: PromotionTarget;
    readonly staged: ReadonlyMap<string, Relation>;
    readonly published: ReadonlyMap<string, Relation>;
  },
  decide: (held: ReadonlySet<string>) => ReadonlySet<string>,
): Promise<{ chosen: Set<string>; heldByViews: Map<string, string[]> }> {
  const { exec, target, staged, published } = catalogue;
  const held = new Set<string>();
  const heldByViews = new Map<string, string[]>();
  for (;;) {
    const chosen = new Set(decide(held));
    let changed = false;
    for (const name of chosen) {
      if (!staged.has(name)) {
        held.add(name);
        changed = true;
        continue;
      }
      const standing = published.get(name);
      if (standing === undefined) {
        continue;
      }
      const pinning = (await dependentsOf(exec, standing)).filter(
        (d) =>
          d.schema !== target.stagingSchema &&
          !(d.schema === target.analyticsSchema && chosen.has(d.name)),
      );
      if (pinning.length > 0) {
        held.add(name);
        heldByViews.set(
          name,
          pinning.map((d) => d.name),
        );
        changed = true;
      }
    }
    if (!changed) {
      return { chosen, heldByViews };
    }
  }
}

/**
 * Drop the published versions being replaced and the staging scratch that reads them,
 * dependents before what they depend on, each RESTRICT. `moving` are the staging relations about
 * to be published, which are never dropped.
 */
async function dropReplaced(
  exec: SqlExecutor,
  target: PromotionTarget,
  replaced: readonly Relation[],
  moving: ReadonlySet<string>,
): Promise<void> {
  const doomed = new Map(replaced.map((r) => [keyOf(r), r]));
  const queue = [...replaced];
  for (let relation = queue.pop(); relation !== undefined; relation = queue.pop()) {
    for (const dependent of await dependentsOf(exec, relation)) {
      const key = keyOf(dependent);
      if (dependent.schema === target.stagingSchema && !moving.has(key) && !doomed.has(key)) {
        doomed.set(key, dependent);
        queue.push(dependent);
      }
    }
  }
  while (doomed.size > 0) {
    let dropped = false;
    for (const [key, relation] of doomed) {
      const readers = await dependentsOf(exec, relation);
      if (readers.some((reader) => doomed.has(keyOf(reader)))) {
        continue;
      }
      await dropRelation(exec, relation);
      doomed.delete(key);
      dropped = true;
    }
    if (!dropped) {
      throw new Error(
        `undercroft: the promotion could not order its drops: ${[...doomed.keys()].join(", ")}`,
      );
    }
  }
}

/** A build's steps once published: each model and seed step says whether it was promoted. */
export interface PublishedBuild {
  readonly steps: RunStep[];
  /** Why nothing was published, when the promotion itself failed; else `null`. */
  readonly error: string | null;
  readonly heldByViews: ReadonlyMap<string, readonly string[]>;
}

function marked(steps: readonly RunStep[], promoted: ReadonlySet<string>): RunStep[] {
  return steps.map((step) =>
    step.kind === "test" ? step : { ...step, promoted: promoted.has(step.name) },
  );
}

/**
 * Publish what a build proved, by `promotable` over its steps and the manifest dbt wrote, and
 * mark every model and seed step with whether it was. A promotion that fails rolls back whole:
 * nothing moved, every step held, and `error` says why -- the previous versions still serve.
 */
export async function publishBuild(
  sessions: TenantSessions,
  build: PromotionTarget & { readonly steps: readonly RunStep[]; readonly manifest: unknown },
): Promise<PublishedBuild> {
  const { steps } = build;
  if (!steps.some((step) => step.kind !== "test")) {
    return { steps: [...steps], error: null, heldByViews: new Map() };
  }
  const graph = buildGraph(build.manifest);
  try {
    const outcome = await promote(sessions, build, (held) => promotable(steps, graph, held));
    return {
      steps: marked(steps, outcome.promoted),
      error: null,
      heldByViews: outcome.heldByViews,
    };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      steps: marked(steps, new Set()),
      error: `promotion failed, nothing was published: ${why}`,
      heldByViews: new Map(),
    };
  }
}
