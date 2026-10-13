/**
 * What dbt's `target/manifest.json` says about a build that `run_results.json` does not: which
 * model each test tests (ADR 0129).
 *
 * Beside `dbtProject.ts`, which renders the project and parses the results, because it reads
 * the other file dbt writes after a build; pure, so a fixture pins it.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** What a manifest node's unique id says it is: `model.undercroft.stg_deals` is a model. */
const MODEL_NODE = "model.";
/** dbt's separator in a singular test's file name, `<model>__<what>` (ADR 0130). */
const SINGULAR_SEPARATOR = "__";

/** A manifest node's model dependencies, by name: `model.undercroft.stg_deals` -> `stg_deals`. */
function modelDependencies(node: Record<string, unknown>): string[] {
  const dependsOn = isRecord(node.depends_on) ? node.depends_on : {};
  const nodes = Array.isArray(dependsOn.nodes) ? dependsOn.nodes : [];
  return nodes
    .filter((id): id is string => typeof id === "string" && id.startsWith(MODEL_NODE))
    .map((id) => id.split(".")[2] ?? "")
    .filter((name) => name !== "");
}

/** The one model a manifest's test node tests, or `null` when the manifest does not say. */
function testedModelOf(uniqueId: string, node: Record<string, unknown>): string | null {
  if (typeof node.attached_node === "string" && node.attached_node.startsWith(MODEL_NODE)) {
    return node.attached_node.split(".")[2] ?? null;
  }
  const models = [...new Set(modelDependencies(node))];
  const name = uniqueId.split(".")[2] ?? "";
  const at = name.lastIndexOf(SINGULAR_SEPARATOR);
  if (at > 0) {
    // A SQL test of ours, `<model>__<name>` (ADR 0130): its model is the one it is named for,
    // and only when it reads that model -- one named for a model it does not read is nobody's.
    const named = name.slice(0, at);
    return models.includes(named) ? named : null;
  }
  return models.length === 1 ? (models[0] ?? null) : null;
}

/**
 * Which model each test of a build tests, by the test's unique id, read from dbt's
 * `target/manifest.json` (ADR 0129).
 *
 * NOT FROM THE TEST'S NAME. A generic test is named `<kind>_<model>_<column>`, which is
 * ambiguous as soon as a name holds an underscore -- `not_null_a_b_c` is column `b_c` of `a`
 * or column `c` of `a_b` -- and dbt hashes a long one past recognition. The manifest is
 * dbt's own record of the graph it ran: a generic test's `attached_node` is the model its
 * `schema.yml` entry hangs off, which is exact. A test with none is a singular test: one of
 * ours is named `<model>__<what>` and must `ref()` its model (ADR 0130), so it is that model's
 * when it reads it and nobody's when it does not; any other is the one model it reads, if one.
 *
 * A test this cannot attribute is absent from the map rather than given a model: its step
 * keeps `model: null`, and a model none of whose tests are attributed reads as "unknown"
 * rather than as passing. A manifest that is not dbt's shape gives an empty map.
 */
export function testedModels(manifest: unknown): Map<string, string> {
  const nodes = isRecord(manifest) && isRecord(manifest.nodes) ? manifest.nodes : {};
  const byTest = new Map<string, string>();
  for (const [uniqueId, node] of Object.entries(nodes)) {
    if (!(uniqueId.startsWith("test.") && isRecord(node))) {
      continue;
    }
    const model = testedModelOf(uniqueId, node);
    if (model !== null) {
      byTest.set(uniqueId, model);
    }
  }
  return byTest;
}
