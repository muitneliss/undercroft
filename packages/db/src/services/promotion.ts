/**
 * Which of a build's models and seeds may be published: write, audit, publish (ADR 0131).
 *
 * dbt builds and tests everything in the tenant's staging schema. What the BI login reads is
 * analytics, and a version goes there only when this says so. A node is promotable when:
 *
 * 1. **It built.** Its step is `success`. A model that errored, or that dbt skipped because a
 *    parent failed, has nothing new to publish.
 * 2. **None of its tests refused it.** Every test attributed to it passed or warned. `warn` is a
 *    test its author asked to be told about rather than stopped by (ADR 0130), so it does not
 *    block. `fail`, `error` and `skipped` do: a test that did not run is not one that passed
 *    (CLAUDE.md rule 2).
 * 3. **A failing test that cannot be placed holds everything it could be about.** A test the
 *    manifest does not attribute (ADR 0129) holds every node it reads; one the manifest does not
 *    list at all -- a build that left no manifest -- holds every node of the build. Publishing a
 *    node a failing test might be about would be guessing that it is not.
 * 4. **Every parent this build also built is promoted.** A child read that parent's staging
 *    rows; published over a parent that was held, its figures would be built from rows that
 *    failed, and a view would read staging from analytics. A parent the build did not select
 *    was read from analytics, its last passing version (`ref()` in `dbtProject.ts`), and holds
 *    nothing. A node whose parents the manifest does not list is promoted only when every other
 *    node of the build is promotable by rules 1-3 -- its parents are not known, so any of them
 *    might be one that was held.
 * 5. **Nothing the caller refuses.** `held` is the worker's: a view outside the build that reads
 *    the version a node would replace (`promote.ts`).
 *
 * Pure, over the steps and the manifest's graph, so a fixture pins it.
 */

import type { RunStep } from "../repos/runs.ts";

/** What a build's graph says, as `buildGraph` (`dbtManifest.ts`) reads it from the manifest. */
export interface PromotionGraph {
  readonly parents: ReadonlyMap<string, readonly string[]>;
  readonly testReads: ReadonlyMap<string, readonly string[]>;
}

/** The two statuses a test may end in and leave its model publishable. */
const ADMITTED = new Set(["pass", "warn"]);

/** Which nodes of the build's steps the failing tests hold, or `null` for "all of them". */
function heldByTests(steps: readonly RunStep[], graph: PromotionGraph): Set<string> | null {
  const held = new Set<string>();
  for (const step of steps) {
    if (step.kind !== "test" || ADMITTED.has(step.status)) {
      continue;
    }
    if (step.model !== null && step.model !== undefined) {
      held.add(step.model);
      continue;
    }
    const reads = graph.testReads.get(step.uniqueId);
    if (reads === undefined) {
      return null;
    }
    for (const name of reads) {
      held.add(name);
    }
  }
  return held;
}

/**
 * The names of the build's models and seeds that may be promoted, by the rules above. Every
 * other model or seed step of the build is held back, and its published version, if it has one,
 * keeps serving.
 */
export function promotable(
  steps: readonly RunStep[],
  graph: PromotionGraph,
  held: ReadonlySet<string> = new Set(),
): Set<string> {
  const nodes = steps.filter((step) => step.kind !== "test");
  const inBuild = new Set(nodes.map((step) => step.name));
  const byTests = heldByTests(steps, graph);
  if (byTests === null) {
    return new Set();
  }
  const standsAlone = new Set(
    nodes
      .filter(
        (step) => step.status === "success" && !byTests.has(step.name) && !held.has(step.name),
      )
      .map((step) => step.name),
  );
  const everyStands = standsAlone.size === inBuild.size;

  const decided = new Map<string, boolean>();
  const visiting = new Set<string>();
  function promote(name: string): boolean {
    const known = decided.get(name);
    if (known !== undefined) {
      return known;
    }
    if (!standsAlone.has(name) || visiting.has(name)) {
      decided.set(name, false);
      return false;
    }
    visiting.add(name);
    const parents = graph.parents.get(name);
    const ok =
      parents === undefined
        ? everyStands
        : parents.every((parent) => !inBuild.has(parent) || promote(parent));
    visiting.delete(name);
    decided.set(name, ok);
    return ok;
  }
  return new Set([...inBuild].filter(promote));
}
