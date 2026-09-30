/**
 * Which models read which, and which raw lake tables each reads -- as the models themselves
 * declare it, and nothing more. `models.lineage` answers with this. ADR 0092.
 *
 * A relation is drawn only where a model's own text declares it: `ref('m')` for a model, and
 * `source('undercroft', 't')` for a raw lake table, each with every argument a plain literal,
 * exactly as `jinja.ts` reads them for `models.check`. A macro's declarations count for the
 * model that calls it, through as many macros as it takes: the shipped `gmail_letters()` reads
 * `source('undercroft', 'records')`, so a model that calls it reads the raw records, and a
 * tenant's macro (ADR 0086) is read the same way from its saved text.
 *
 * WHY NOTHING IS INFERRED. Every source account lands in the same raw tables and a model picks
 * its account by a filter (ADR 0002, 0043), and nothing in a model's row says which question
 * reads it. An edge guessed from a similar name, a `where source = ...` or the data would look
 * exactly like a declared one, and a reader would trust it the same. So there are no
 * source-account or report nodes here, and two models called `stg_deals` and `stg_deals_v2`
 * are joined only if one refs the other.
 *
 * WHY "UPSTREAM NOT DECLARED" RATHER THAN NO PARENTS. A model whose upstream cannot be read
 * from its declarations carries the reasons, and is never shown as a model that reads nothing:
 * a missing edge must not look like proof of no dependency (rule 2). The reasons are a ref or
 * source with an argument that is not a literal, a call to a macro the project does not hold, a
 * relation named directly past `ref()`/`source()` (what `models.check` reports as `raw-direct`
 * and `analytics-direct`, and any table of a declared source's schema named after `from` or
 * `join`, such as `raw.document_text`), and a query run from inside Jinja (`run_query`,
 * `statement`), whose SQL is a string no reader can follow.
 *
 * WHY A MISSING DEPENDENCY IS KEPT. Deleting a model leaves the models that ref it in place,
 * and their next build fails and says why (ADR 0077). The ref is still a declaration; dropping
 * its edge would hide the one thing about that model a reader most needs to see.
 *
 * Pure: the tenant's models and macros are the caller's to read.
 */

import { MACROS } from "./dbtProject.ts";
import { SOURCES } from "./dbtSources.ts";
import { DBT_CONTEXT, type JinjaReference, readJinja } from "./jinja.ts";
import { readMacroDefinition } from "./macroDefinition.ts";
import { bareModelFindings, sqlFindings } from "./sqlChecks.ts";
import { isName, lex, type Token } from "./sqlLexer.ts";

/** A saved model or macro: its name and its text. */
export interface LineageText {
  readonly name: string;
  readonly sql: string;
}

export interface LineageInput {
  readonly models: readonly LineageText[];
  /** The tenant's own macros. The platform's (`MACROS`) are known here already. */
  readonly macros: readonly LineageText[];
}

export type UndeclaredCode =
  | "dynamic-reference"
  | "unknown-macro"
  | "direct-read"
  | "query-in-jinja";

/** One reason a model's upstream cannot be read from its declarations. */
export interface Undeclared {
  readonly code: UndeclaredCode;
  /** What it is about: `ref` or `source`, a macro's name, a relation as written. */
  readonly subject: string | null;
  /** The macro whose own text holds it, or `null` when the model's text does. */
  readonly via: string | null;
}

/**
 * A model; a raw lake table a source declares, named `schema.table`; or a declared relation
 * to something the project does not hold -- a model since deleted, a source table never
 * declared -- named as it was written.
 */
export type LineageNode =
  | {
      readonly kind: "model";
      readonly id: string;
      readonly name: string;
      /** Empty when every relation of the model is declared. */
      readonly undeclared: readonly Undeclared[];
    }
  | { readonly kind: "raw"; readonly id: string; readonly name: string }
  | { readonly kind: "missing"; readonly id: string; readonly name: string };

/** `from` is read by the model `to`. */
export interface LineageEdge {
  readonly from: string;
  readonly to: string;
  /** The macro whose own text declares it, or `null` when the model's text does. */
  readonly via: string | null;
}

export interface Lineage {
  readonly nodes: readonly LineageNode[];
  readonly edges: readonly LineageEdge[];
}

interface Parent {
  readonly kind: "model" | "raw" | "missing";
  readonly name: string;
}

/** What one text declares by itself, before the macros it calls are followed. */
interface Reading {
  readonly parents: readonly Parent[];
  readonly undeclared: readonly Omit<Undeclared, "via">[];
  /** The project's macros it calls, itself excluded. */
  readonly calls: readonly string[];
}

/** Calls that run SQL written as a string at compile time: whatever it reads is not declared. */
const QUERYING: ReadonlySet<string> = new Set(["run_query", "statement"]);
/** What Jinja binds inside every macro: the arguments no parameter named. */
const MACRO_IMPLICITS = ["varargs", "kwargs"] as const;
const SOURCE_SCHEMAS: ReadonlySet<string> = new Set(SOURCES.map((source) => source.schema));

function nodeId(kind: Parent["kind"], name: string): string {
  return `${kind}:${name}`;
}

/** A literal `ref()` or `source()` as the node it names. */
function parentOf(
  { fn, args }: JinjaReference & { args: readonly string[] },
  models: ReadonlySet<string>,
): Parent {
  if (fn === "ref") {
    // `ref('model')` or `ref('package', 'model')`: the model is the last argument.
    const model = args.at(-1) ?? "";
    return { kind: models.has(model) ? "model" : "missing", name: model };
  }
  const [name = "", table = ""] = args;
  const source = SOURCES.find((declared) => declared.name === name);
  return args.length === 2 && source?.tables.includes(table) === true
    ? { kind: "raw", name: `${source.schema}.${table}` }
    : { kind: "missing", name: args.join(".") };
}

/** `raw.records`, for a `raw-direct` finding that names the table alone. */
function sourceRelation(table: string): string {
  const source = SOURCES.find((declared) => declared.tables.includes(table));
  return source === undefined ? table : `${source.schema}.${table}`;
}

/**
 * Any table of a declared source's schema named as a relation: `from raw.document_text`.
 * Only after `from` or `join`, because anywhere else `raw.x` is as likely a column of a
 * relation aliased `raw` -- a model reading `source(...)` as `raw` is not reading past it.
 */
function schemaReads(tokens: readonly Token[]): string[] {
  return tokens.flatMap((token, index) => {
    const [dot, table] = [tokens[index + 1], tokens[index + 2]];
    const relation = isName(tokens[index - 1], "from") || isName(tokens[index - 1], "join");
    const named = token.kind === "word" || token.kind === "quoted";
    return relation && named && SOURCE_SCHEMAS.has(token.text) && dot?.text === "." && table
      ? [`${token.text}.${table.text}`]
      : [];
  });
}

/** Every relation the SQL names directly, past `ref()` and `source()`. */
function directReads(sql: string, models: ReadonlySet<string>): string[] {
  const tokens = lex(sql);
  const named = [...sqlFindings(tokens), ...bareModelFindings(tokens, models)].flatMap((found) => {
    if (found.code === "raw-direct") {
      return [sourceRelation(found.subject ?? "")];
    }
    return found.code === "analytics-direct" ? [found.subject ?? ""] : [];
  });
  return [...new Set([...named, ...schemaReads(tokens)])];
}

/** Names a macro may call besides the project's: its own parameters and what Jinja binds. */
function ownNames(macro: LineageText | null): ReadonlySet<string> {
  if (macro === null) {
    return new Set();
  }
  const definition = readMacroDefinition(macro.name, macro.sql);
  // The platform's macros are reserved names, so the reader refuses them; none calls a
  // parameter, which `modelLineage.test.ts` pins by reading each one as declared.
  const params = definition.ok ? definition.params : [];
  return new Set([macro.name, ...params, ...MACRO_IMPLICITS]);
}

/** What one text declares by itself; `macro` is the text when it is a macro, else `null`. */
function read(
  text: LineageText,
  macro: LineageText | null,
  models: ReadonlySet<string>,
  macros: ReadonlySet<string>,
): Reading {
  const jinja = readJinja(text.sql);
  const own = ownNames(macro);
  const parents: Parent[] = [];
  const undeclared: Omit<Undeclared, "via">[] = [];
  for (const reference of jinja.references) {
    const { args } = reference;
    if (args === null) {
      undeclared.push({ code: "dynamic-reference", subject: reference.fn });
    } else {
      parents.push(parentOf({ ...reference, args }, models));
    }
  }
  const calls: string[] = [];
  for (const { name } of jinja.calls) {
    if (own.has(name)) {
      continue;
    }
    if (macros.has(name)) {
      calls.push(name);
    } else if (QUERYING.has(name)) {
      undeclared.push({ code: "query-in-jinja", subject: name });
    } else if (!(DBT_CONTEXT.has(name) || jinja.bound.has(name))) {
      undeclared.push({ code: "unknown-macro", subject: name });
    }
  }
  for (const relation of directReads(jinja.text, models)) {
    undeclared.push({ code: "direct-read", subject: relation });
  }
  return { parents, undeclared, calls };
}

/** One entry per key, the first kept: a direct declaration is listed before a macro's. */
function distinctBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const fresh = !seen.has(key(item));
    seen.add(key(item));
    return fresh;
  });
}

/**
 * The model's own reading with every macro it reaches folded in, each tagged with the macro
 * that holds it. A macro reached twice, or calling back into one already read, is read once.
 */
function resolve(
  own: Reading,
  macroReadings: ReadonlyMap<string, Reading>,
): { parents: (Parent & { via: string | null })[]; undeclared: Undeclared[] } {
  const parents: (Parent & { via: string | null })[] = own.parents.map((parent) => ({
    ...parent,
    via: null,
  }));
  const undeclared: Undeclared[] = own.undeclared.map((reason) => ({ ...reason, via: null }));
  const seen = new Set<string>();
  const queue = [...own.calls];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    const reading = macroReadings.get(name);
    if (seen.has(name) || reading === undefined) {
      continue;
    }
    seen.add(name);
    parents.push(...reading.parents.map((parent) => ({ ...parent, via: name })));
    undeclared.push(...reading.undeclared.map((reason) => ({ ...reason, via: name })));
    queue.push(...reading.calls);
  }
  return { parents, undeclared };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

/**
 * The tenant's models as a graph of what each declares it reads: a node per model, per raw
 * lake table read and per declared relation to something absent; an edge per declaration.
 */
export function modelLineage(input: LineageInput): Lineage {
  const models = new Set(input.models.map((model) => model.name));
  const platform = new Set(MACROS.map((macro) => macro.name));
  // A tenant's macro cannot take a platform macro's name (`macroDefinition.ts`); if a row
  // somehow did, the platform's is the one dbt would call.
  const allMacros = [...MACROS, ...input.macros.filter((macro) => !platform.has(macro.name))];
  const macroNames = new Set(allMacros.map((macro) => macro.name));
  const macroReadings = new Map(
    allMacros.map((macro) => [macro.name, read(macro, macro, models, macroNames)]),
  );

  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];
  for (const model of [...input.models].sort(byName)) {
    const { parents, undeclared } = resolve(read(model, null, models, macroNames), macroReadings);
    const id = nodeId("model", model.name);
    nodes.set(id, {
      kind: "model",
      id,
      name: model.name,
      undeclared: distinctBy(undeclared, (r) => `${r.code}|${r.subject ?? ""}|${r.via ?? ""}`),
    });
    for (const parent of parents) {
      const from = nodeId(parent.kind, parent.name);
      if (parent.kind !== "model" && !nodes.has(from)) {
        nodes.set(from, { kind: parent.kind, id: from, name: parent.name });
      }
      edges.push({ from, to: id, via: parent.via });
    }
  }
  const all = [...nodes.values()];
  return {
    nodes: [
      ...all.filter((node) => node.kind === "raw").sort(byName),
      ...all.filter((node) => node.kind === "model"),
      ...all.filter((node) => node.kind === "missing").sort(byName),
    ],
    edges: distinctBy(edges, (edge) => `${edge.from}|${edge.to}`),
  };
}
