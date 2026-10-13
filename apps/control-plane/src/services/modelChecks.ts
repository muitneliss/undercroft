/**
 * What can be said about a model before it is stored: its SQL and tests against the tenant's own
 * model and macro names (`checkModel`, `checkTests`). Reads, stores nothing.
 *
 * Beside `models.ts`, which saves through `refusedTest` and answers `models.check` with
 * `check`, so the module that stores a model is not also the one that reads every name a check
 * needs.
 */

import type { ModelTests } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { listMacros, listModels } from "@undercroft/db/repos";
import { checkModel, checkTests, type Finding, type ModelCheck } from "@undercroft/db/services";

/** The first error `checkTests` finds in `tests`, or `null`; reads the tenant only when needed. */
export async function refusedTest(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
  tests: ModelTests,
): Promise<Finding | null> {
  const relates = Object.values(tests.columns).some((declaredTests) =>
    declaredTests.some(
      (declared) => typeof declared !== "string" && declared.kind === "relationships",
    ),
  );
  if (!relates && (tests.sql ?? []).length === 0) {
    return null;
  }
  const [existing, macros] = await Promise.all([
    listModels(exec, tenantId),
    listMacros(exec, tenantId),
  ]);
  const findings = checkTests({
    name,
    tests,
    existingModels: existing.map((model) => model.name),
    existingMacros: macros.map((macro) => macro.name),
  });
  return findings.find((found) => found.severity === "error") ?? null;
}

/**
 * What can be said about a model's SQL before it is saved or built, against the tenant's own
 * model and macro names. Reads, stores nothing, and is not the security boundary: the tenant's
 * dbt login's grants are (`modelCheck.ts`).
 */
export async function check(
  exec: SqlExecutor,
  input: { tenantId: string; name: string; sql: string; tests: ModelTests },
): Promise<ModelCheck> {
  const [existing, macros] = await Promise.all([
    listModels(exec, input.tenantId),
    listMacros(exec, input.tenantId),
  ]);
  return checkModel({
    name: input.name,
    sql: input.sql,
    tests: input.tests,
    existingModels: existing.map((model) => model.name),
    existingMacros: macros.map((macro) => macro.name),
  });
}
