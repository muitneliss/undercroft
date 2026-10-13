/**
 * The guard in front of a build that would copy a parent's rows without testing them (issue
 * 457, ADR 0129).
 *
 * `dbt build --select fct` builds `fct` from whatever `stg` holds now, and runs none of `stg`'s
 * tests. A scheduled build of everything skips `fct` when `stg`'s tests fail; a build of `fct`
 * alone does not, so it would publish the very rows those tests just refused, and report
 * success. This reads, before the build, the latest tests of every parent the build reads but
 * does not build, and refuses when one of them is failing.
 *
 * "Does not build" is computed from the selection the way dbt reads it: `name` builds the
 * model, `+name` it and everything upstream, `name+` it and everything downstream. A parent
 * inside that set is rebuilt and tested in the same run, before its children -- dbt skips the
 * children if it fails -- so it needs no guard. The graph is the stored models' declared
 * `ref()`s (`modelLineage`, ADR 0092); raw lake sources have no tests of ours and are not
 * parents here, and a read a model's text does not declare is not seen (ADR 0092 says why).
 *
 * A parent whose tests are `unknown` -- it has none, or never built -- does not refuse the
 * build: refusing would make every model over an untested one unbuildable alone, which is the
 * state of most projects today. It is named in the answer instead, as unknown and not as
 * passing (ADR 0129 records the choice).
 */

import { type ModelSelector, selectedModel } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { listMacros, listModels } from "@undercroft/db/repos";
import { type Lineage, lineageAround, modelLineage } from "@undercroft/db/services";

import { readTestStates, type TestDetail } from "./testState.ts";

/** A parent the build reads without building it, the selected models that read it, and its tests. */
export interface ParentTests {
  readonly parent: string;
  /** The models of this build that read it, by name. */
  readonly readBy: readonly string[];
  readonly tests: TestDetail;
}

export type GuardOutcome =
  /** Nothing failing; `unknown` lists the parents with no test record, by name. */
  | { readonly ok: true; readonly unknown: readonly string[] }
  /** At least one parent's latest tests failed: every such parent, in name order. */
  | { readonly ok: false; readonly failing: readonly ParentTests[] };

/** Model names reached from `name` one way, the model itself included. */
function reach(graph: Lineage, name: string, direction: "up" | "down"): string[] {
  const around = lineageAround(graph, { name, direction, depth: null });
  return (around?.nodes ?? []).filter((n) => n.kind === "model").map((n) => n.name);
}

/** Every model a selection builds, as dbt resolves `name`, `+name` and `name+`. */
export function builtBy(graph: Lineage, select: readonly ModelSelector[]): Set<string> {
  const built = new Set<string>();
  for (const selector of select) {
    const name = selectedModel(selector);
    built.add(name);
    if (selector.startsWith("+")) {
      for (const model of reach(graph, name, "up")) {
        built.add(model);
      }
    }
    if (selector.endsWith("+")) {
      for (const model of reach(graph, name, "down")) {
        built.add(model);
      }
    }
  }
  return built;
}

/**
 * Each model a build reads without building it, with the built models that read it: the
 * direct model parents of the built set, outside it. Pure, over the declared graph.
 */
export function parentsOutside(
  graph: Lineage,
  select: readonly ModelSelector[],
): Map<string, string[]> {
  const built = builtBy(graph, select);
  const models = new Map(
    graph.nodes.filter((n) => n.kind === "model").map((n) => [n.id, n.name] as const),
  );
  const outside = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const parent = models.get(edge.from);
    const child = models.get(edge.to);
    if (parent === undefined || child === undefined || !built.has(child) || built.has(parent)) {
      continue;
    }
    const readBy = outside.get(parent) ?? [];
    if (!readBy.includes(child)) {
      readBy.push(child);
    }
    outside.set(parent, readBy);
  }
  return outside;
}

/** Read the latest tests of every parent a build would read without building, and decide. */
export async function guardParents(
  exec: SqlExecutor,
  tenantId: string,
  select: readonly ModelSelector[],
): Promise<GuardOutcome> {
  const [models, macros] = await Promise.all([
    listModels(exec, tenantId),
    listMacros(exec, tenantId),
  ]);
  const outside = parentsOutside(modelLineage({ models, macros }), select);
  if (outside.size === 0) {
    return { ok: true, unknown: [] };
  }
  const parents = [...outside.keys()].sort();
  const testsOf = await readTestStates(exec, tenantId, parents);
  const read = parents.map((parent) => ({
    parent,
    readBy: outside.get(parent) ?? [],
    tests: testsOf(parent),
  }));
  const failing = read.filter((p) => p.tests.state === "failing");
  if (failing.length > 0) {
    return { ok: false, failing };
  }
  return {
    ok: true,
    unknown: read.filter((p) => p.tests.state === "unknown").map((p) => p.parent),
  };
}
