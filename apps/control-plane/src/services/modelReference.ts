/**
 * What a model of a tenant can read and call: the `sources.yml` and macros every project carries,
 * and the tenant's own macros (ADR 0086). For the editor's reference panel, whole, and for an
 * agent choosing what to call, in parts.
 *
 * Two of the three parts are the same text for every tenant on every call, and an agent reading
 * its tenant's macros through here paid 35 KB a call for them (issue 444). So a reader may name
 * the parts it wants, and the tenant's macros are read from the database only when asked for.
 */

import type { SqlExecutor } from "@undercroft/db";
import { listMacros } from "@undercroft/db/repos";
import { MACROS, SOURCES_YML } from "@undercroft/db/services";

/** The three parts of the reference, which a reader may ask for one at a time. */
export const REFERENCE_PARTS = ["sources", "platformMacros", "tenantMacros"] as const;
export type ReferencePart = (typeof REFERENCE_PARTS)[number];

export interface Reference {
  /** Part `sources`: the `sources.yml` every project carries. The same for every tenant. */
  readonly sourcesYml: string;
  /** Part `platformMacros`: what the platform ships into every project. The same for every tenant. */
  readonly macros: { name: string; sql: string }[];
  /** Part `tenantMacros`: the tenant's own macros, which any of its models may call too. */
  readonly tenantMacros: { name: string; description: string; sql: string }[];
}

/**
 * The parts a reader named, and only those, marked with what was asked: an answer without
 * `sourcesYml` must not read as a project with no sources.
 */
export type ReferenceParts = Partial<Reference> & { readonly parts: readonly ReferencePart[] };

/** The reference whole, as the editor's panel asks for it. */
export async function reference(exec: SqlExecutor, tenantId: string): Promise<Reference> {
  return {
    sourcesYml: SOURCES_YML,
    macros: platformMacros(),
    tenantMacros: await tenantMacrosOf(exec, tenantId),
  };
}

/** Only the parts named, each as `reference` answers it. */
export async function referenceParts(
  exec: SqlExecutor,
  tenantId: string,
  parts: readonly ReferencePart[],
): Promise<ReferenceParts> {
  return {
    parts: [...new Set(parts)],
    ...(parts.includes("sources") ? { sourcesYml: SOURCES_YML } : {}),
    ...(parts.includes("platformMacros") ? { macros: platformMacros() } : {}),
    ...(parts.includes("tenantMacros")
      ? { tenantMacros: await tenantMacrosOf(exec, tenantId) }
      : {}),
  };
}

function platformMacros(): Reference["macros"] {
  return MACROS.map((m) => ({ name: m.name, sql: m.sql }));
}

async function tenantMacrosOf(
  exec: SqlExecutor,
  tenantId: string,
): Promise<Reference["tenantMacros"]> {
  return (await listMacros(exec, tenantId)).map((m) => ({
    name: m.name,
    description: m.description,
    sql: m.sql,
  }));
}
