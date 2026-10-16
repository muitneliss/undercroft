/**
 * The router's description as data: the shape `procedureManifest` answers with, which the CLI
 * bakes into its bundle and a model-context door serves as its tool list (ADR 0044, ADR 0060).
 *
 * Split from `surface.ts` when ADR 0139 gave each procedure its permission, because that file
 * is what the compiler knows about the router and the facts a person wrote beside it, and this
 * is the wire shape built from both. `surface.ts` re-exports both types, so every caller still
 * names one module.
 */

import type { Permission } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core/locale";
import type { Effect, ProcedurePath } from "./surface.ts";

/** A JSON Schema, as far as a caller reads one. Everything else in it is passed through. */
export interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly default?: unknown;
  readonly anyOf?: readonly JsonSchema[];
}

/**
 * One procedure, described: the router's own facts joined with the tables above.
 *
 * Plain data, so it can be baked into a bundle that holds no router code (the CLI) or served
 * to a client that has never seen TypeScript.
 */
export interface ProcedureSpec {
  /** The router's dotted path, e.g. `bi.questions.save`. */
  readonly path: ProcedurePath;
  readonly type: "query" | "mutation";
  /** The merged input of the procedure's whole chain, `tenantProcedure`'s `tenantId` included. */
  readonly input: JsonSchema;
  /**
   * Whether the procedure is scoped to a tenant the caller already holds authority in.
   *
   * What lets a caller offer the tenants it can see: `runs.list` wants one of them,
   * `tenants.create` wants a NEW id, and both call the field `tenantId`.
   */
  readonly tenantScoped: boolean;
  /**
   * The one permission the procedure declares with `requirePermission`, read off its middleware
   * chain (ADR 0139); `null` for one any member, any signed-in person or anyone may call. A
   * procedure whose need depends on its input -- `bi.exports.create` -- checks inside and says
   * so in its sentence.
   */
  readonly permission: Permission | null;
  readonly effect: Effect;
  /**
   * What the procedure does, in each language, from `../i18n/procedures.{vi,en}.ts` -- followed,
   * when it declares a permission, by the sentence naming it, so the words a caller reads and
   * the gate the router enforces are one fact.
   */
  readonly description: Readonly<Record<Locale, string>>;
}
