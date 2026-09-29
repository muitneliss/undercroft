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

import { record as recordAudit } from "../repos/auditLog.ts";

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
  };
}

export async function list(exec: SqlExecutor, tenantId: string): Promise<MacroItem[]> {
  return (await listMacros(exec, tenantId)).map(item);
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
 * What can be said about a macro before it is saved, against the tenant's own models and
 * macros. Reads, stores nothing.
 */
export async function check(
  exec: SqlExecutor,
  input: { tenantId: string; name: string; sql: string },
): Promise<ModelCheck> {
  const [models, macros] = await Promise.all([
    listModels(exec, input.tenantId),
    listMacros(exec, input.tenantId),
  ]);
  return checkMacro({
    name: input.name,
    sql: input.sql,
    existingModels: models.map((model) => model.name),
    existingMacros: macros.map((macro) => macro.name),
  });
}

export type SaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "name-taken" }
  | {
      readonly ok: false;
      readonly reason: "refused";
      readonly refusal: MacroRefusal;
      readonly subject: string | null;
    };

/**
 * Store the macro, if its definition is one a tenant may have. With `create`, a name already in
 * use is refused and nothing is written.
 */
export async function save(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    name: string;
    description: string;
    sql: string;
    create: boolean;
    actor: string;
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
  if (input.create) {
    if (!(await insertMacro(exec, input.tenantId, macro))) {
      return { ok: false, reason: "name-taken" };
    }
  } else {
    await saveMacro(exec, input.tenantId, macro);
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "macros.save",
    detail: JSON.stringify({ name: input.name, created: input.create }),
  });
  return { ok: true };
}

export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "depended-on"; readonly dependents: readonly string[] };

/** Delete the macro, unless a model or another macro of the tenant still calls it. */
export async function remove(
  exec: SqlExecutor,
  input: { tenantId: string; name: string; actor: string },
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
