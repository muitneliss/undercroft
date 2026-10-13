/**
 * The customer's own dbt macros: listed, read, checked, saved and deleted. ADR 0086.
 *
 * A macro is how a tenant writes an expression once -- a company name normalised, a status
 * mapped -- and calls it from every model that needs it, rather than copying it into each and
 * letting the copies drift. The worker renders every macro of the tenant into each build.
 *
 * Save stores and runs nothing, like a model's. Unlike a model's, it refuses: a definition
 * `macroDefinition.ts` does not admit -- a reserved name, a second block, a name that is not
 * the row's -- would change what the tenant's WHOLE project means, silently, so it never
 * reaches the table. Everything else `macros.check` finds is advice.
 *
 * Delete refuses while any model or other macro calls the macro: every build of the tenant
 * would fail on the call, and the one who deleted it would not be the one to find out. The
 * dependents are named so the person knows where to look.
 *
 * The audit row names the macro and who saved it, never its text: the text is in the table.
 */

import type { SqlExecutor } from "@undercroft/db";
import {
  deleteMacro,
  getMacro,
  insertMacro,
  listMacros,
  listModels,
  listSeedSummaries,
  type Macro,
  saveMacro,
} from "@undercroft/db/repos";
import {
  callersOf,
  checkMacro,
  type MacroRefusal,
  type ModelCheck,
  readMacroDefinition,
} from "@undercroft/db/services";

import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { type Listing, listed, mapNarrowed, type NameFilter, narrowByName } from "./listFilter.ts";
import type { PageRequest } from "./listPage.ts";

export interface MacroItem {
  readonly name: string;
  readonly description: string;
  /**
   * The parameters the definition takes, in order. `null` for a stored definition that no
   * longer reads as one macro -- one saved before a name was reserved -- rather than a guess.
   */
  readonly params: readonly string[] | null;
  readonly updatedBy: string;
  readonly updatedAt: string;
  /** Hex SHA-256 of the stored definition's UTF-8 bytes: the same text hashes the same anywhere. */
  readonly sqlSha256: string;
  /** Hex SHA-256 of the stored description's UTF-8 bytes. */
  readonly descriptionSha256: string;
}

export type MacroDetail = MacroItem & { readonly sql: string };

function item(macro: Macro): MacroItem {
  const definition = readMacroDefinition(macro.name, macro.sql);
  return {
    name: macro.name,
    description: macro.description,
    params: definition.ok ? definition.params : null,
    updatedBy: macro.updatedBy,
    updatedAt: macro.updatedAt,
    sqlSha256: macro.sqlSha256,
    descriptionSha256: macro.descriptionSha256,
  };
}

/**
 * The tenant's macros, without their definitions, narrowed by `filter` and paged by name when
 * asked (`listFilter.ts`). `listMacros` reads them `ORDER BY name`, and a name is unique.
 */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  filter: NameFilter & PageRequest = {},
): Promise<Listing<MacroItem>> {
  const macros = await listMacros(exec, tenantId);
  return listed(
    mapNarrowed(
      narrowByName(macros, (macro) => macro.name, filter),
      item,
    ),
    (macro) => macro.name,
    filter,
  );
}

export async function get(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<MacroDetail | null> {
  const macro = await getMacro(exec, tenantId, name);
  return macro === null ? null : { ...item(macro), sql: macro.sql };
}

/**
 * What can be said about a macro before it is saved, against the tenant's own models, macros
 * and seeds. Reads, stores nothing.
 */
export async function check(
  exec: SqlExecutor,
  input: { tenantId: string; name: string; sql: string },
): Promise<ModelCheck> {
  const [models, macros, seeds] = await Promise.all([
    listModels(exec, input.tenantId),
    listMacros(exec, input.tenantId),
    listSeedSummaries(exec, input.tenantId),
  ]);
  return checkMacro({
    name: input.name,
    sql: input.sql,
    existingModels: models.map((model) => model.name),
    existingMacros: macros.map((macro) => macro.name),
    existingSeeds: seeds.map((seed) => seed.name),
  });
}

export type SaveOutcome =
  | { readonly ok: true; readonly unchanged: boolean }
  | { readonly ok: false; readonly reason: "name-taken" }
  | {
      readonly ok: false;
      readonly reason: "refused";
      readonly refusal: MacroRefusal;
      readonly subject: string | null;
    };

/**
 * Store the macro, if its definition is one a tenant may have. With `create`, a name already in
 * use is refused and nothing is written. The description and definition already stored are
 * `unchanged`, written and recorded nowhere, as a model's are (`models.ts`, ADR 0127).
 */
export async function save(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    name: string;
    description: string;
    sql: string;
    create: boolean;
    actor: Actor;
    actorId: string;
  },
): Promise<SaveOutcome> {
  const definition = readMacroDefinition(input.name, input.sql);
  if (!definition.ok) {
    return {
      ok: false,
      reason: "refused",
      refusal: definition.reason,
      subject: definition.subject,
    };
  }
  const macro = {
    name: input.name,
    description: input.description,
    sql: input.sql,
    updatedBy: input.actorId,
  };
  const result = input.create
    ? (await insertMacro(exec, input.tenantId, macro))
      ? "written"
      : "name-taken"
    : await saveMacro(exec, input.tenantId, macro);
  if (result === "name-taken") {
    return { ok: false, reason: "name-taken" };
  }
  if (result === "written") {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "macros.save",
      detail: JSON.stringify({ name: input.name, created: input.create }),
    });
  }
  return { ok: true, unchanged: result === "unchanged" };
}

export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "depended-on"; readonly dependents: readonly string[] };

/** Delete the macro, unless a model or another macro of the tenant still calls it. */
export async function remove(
  exec: SqlExecutor,
  input: { tenantId: string; name: string; actor: Actor },
): Promise<RemoveOutcome> {
  const [models, macros] = await Promise.all([
    listModels(exec, input.tenantId),
    listMacros(exec, input.tenantId),
  ]);
  if (!macros.some((macro) => macro.name === input.name)) {
    return { ok: false, reason: "not-found" };
  }
  const others = macros.filter((macro) => macro.name !== input.name);
  const dependents = callersOf(input.name, [...models, ...others]);
  if (dependents.length > 0) {
    return { ok: false, reason: "depended-on", dependents };
  }
  if (!(await deleteMacro(exec, input.tenantId, input.name))) {
    return { ok: false, reason: "not-found" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "macros.delete",
    detail: JSON.stringify({ name: input.name }),
  });
  return { ok: true };
}
