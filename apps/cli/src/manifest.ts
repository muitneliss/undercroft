/**
 * What the CLI knows about the platform, and the one rule that names it.
 *
 * The manifest is the router's own description of itself -- every procedure's dotted path,
 * whether it is a query or a mutation, and the JSON Schema of its input -- extracted from
 * `appRouter` at BUILD time by `scripts/build.ts` and bundled in as `virtual:procedures`. It
 * is never written to git, so it cannot drift from the router it describes: a new procedure
 * is a new command the next time the CLI is built, with nothing to hand-edit.
 *
 * The CLI never imports the router itself. What reaches it is data, and what it does with
 * the data is send it over HTTP to `/trpc` -- `.ast-grep/rules/cli-boundary.yml`.
 */

/** A JSON Schema, as far as the CLI reads one. Everything else in it is passed through. */
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

export interface ProcedureSpec {
  /** The router's dotted path, e.g. `bi.questions.save`. */
  readonly path: string;
  readonly type: "query" | "mutation";
  /** The merged input of the procedure's whole chain, `tenantProcedure`'s `tenantId` included. */
  readonly input: JsonSchema;
  /**
   * Whether the procedure is scoped to a tenant the caller already holds authority in.
   *
   * What lets a prompt offer the tenants the caller can see: `runs.list` wants one of them,
   * `tenants.create` wants a NEW id, and both call the field `tenantId`.
   */
  readonly tenantScoped: boolean;
}

/**
 * `startOAuth` -> `start-oauth`, `expiresInDays` -> `expires-in-days`.
 *
 * A capital joins the word before it only after a lowercase letter or a digit, so an acronym
 * stays one word: `OAuth` is `oauth`, not `o-auth`. Commands and flags share this rule, so
 * a person who learned one can predict the other.
 */
export function kebab(name: string): string {
  return name.replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>").toLowerCase();
}

/** The oclif id for a dotted path: `bi.questions.save` -> `bi:questions:save`. */
export function commandId(path: string): string {
  return path.split(".").map(kebab).join(":");
}

/** Every topic the ids imply: each proper prefix, so `bi:questions:save` gives `bi` and `bi:questions`. */
export function topicsOf(ids: readonly string[]): string[] {
  const topics = new Set<string>();
  for (const id of ids) {
    const words = id.split(":");
    for (let end = 1; end < words.length; end += 1) {
      topics.add(words.slice(0, end).join(":"));
    }
  }
  return [...topics].sort();
}

/** How a person types a command id: `bi:questions:save` -> `bi questions save`. */
export function spoken(id: string): string {
  return id.replaceAll(":", " ");
}
