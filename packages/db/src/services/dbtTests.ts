/**
 * How a model's tests become dbt's files, and what dbt names what they leave behind (ADR 0130).
 *
 * A column test is a line of `models/schema.yml`; a SQL test is a singular test under `tests/`.
 * Both are written in dbt 1.9's syntax, the version the worker pins, and both store their
 * failing rows in `dq_<slug>` through the project's `+store_failures` (`dbtProject.ts`).
 *
 * The names are here beside the rendering because they are a statement about what it produces:
 * a test's failing-rows relation is named from the very text written below, so a change to one
 * is a change to the other. `relationsOfModel` reads them for a delete (ADR 0077), the ledger for
 * a step, and the contract's `SQL_TEST_NAME` keeps a SQL test's name free of the `__` that
 * separates it from its model.
 */

import { createHash } from "node:crypto";

import type { ColumnTestJson, ModelTestsJson, SqlTestJson } from "../repos/models.ts";

/** The part of a project model its `schema.yml` entry and its tests are rendered from. */
export interface TestedModel {
  readonly name: string;
  readonly tests: ModelTestsJson;
  /** Its author's description, which dbt carries into its manifest (ADR 0137). */
  readonly description: string | null;
}

/** dbt 1.9: a generic test name this long or longer is truncated and hashed. */
const LONG_TEST_NAME = 64;
/** dbt 1.9: how much of `<kind>_<model>` a truncated test name keeps before its hash. */
const TEST_NAME_KEPT = 30;
/** What dbt 1.9 replaces, a run at a time, in an argument it puts in a test's name. */
const NOT_IN_A_TEST_NAME = /[^0-9a-zA-Z_]+/gu;

/**
 * A YAML scalar, double-quoted: JSON's string syntax is YAML's. Every name written into
 * `schema.yml` goes through it, as a key's value or a value: dbt reads YAML 1.1, where a bare
 * `on`, `no`, `yes`, `off`, `true` or `null` -- each a valid model or column name -- is a boolean
 * or nothing, and the model or column it names would silently stop being the one tested.
 */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * An accepted value as dbt 1.9's `accepted_values` splices it into `'<value>'`: with no escaping
 * of its own, so a single quote is doubled here and the value stays one SQL string. The
 * contract has already refused braces, which dbt would read as Jinja.
 */
function sqlQuotedValue(value: string, quote: boolean): string {
  return quote ? value.replaceAll("'", "''") : value;
}

/** What `relationships.to` says in the YAML: dbt resolves it as a `ref()`, a seed's included. */
function refOf(model: string): string {
  return `ref('${model}')`;
}

/** The severity of a test as dbt reads it, `config:` indented under it; nothing when `error`. */
function severityLines(severity: string | undefined, indent: string): string[] {
  return severity === "warn" ? [`${indent}config:`, `${indent}  severity: warn`] : [];
}

/**
 * One column test in dbt 1.9's syntax: arguments as the test's own top-level properties and
 * severity under `config:`. dbt 1.10.5 nests arguments under `arguments:`, which 1.9 would read
 * as one argument named `arguments` (https://docs.getdbt.com/reference/resource-properties/data-tests).
 * Values are YAML double-quoted strings, so a number stays the text it was written as.
 */
function columnTestLines(test: ColumnTestJson): string[] {
  const item = "          - ";
  const argument = "              ";
  if (typeof test === "string") {
    return [item.concat(test)];
  }
  const head = `${item}${test.kind}:`;
  switch (test.kind) {
    case "accepted_values": {
      const quote = test.quote !== false;
      const values = (test.values ?? []).map((v) => yamlString(sqlQuotedValue(v, quote)));
      return [
        head,
        `${argument}values: [${values.join(", ")}]`,
        ...(test.quote === undefined ? [] : [`${argument}quote: ${String(test.quote)}`]),
        ...severityLines(test.severity, argument),
      ];
    }
    case "relationships":
      return [
        head,
        `${argument}to: ${yamlString(refOf(test.to ?? ""))}`,
        `${argument}field: ${yamlString(test.field ?? "")}`,
        ...severityLines(test.severity, argument),
      ];
    default: {
      const config = severityLines(test.severity, argument);
      return config.length === 0 ? [`${item}${test.kind}`] : [head, ...config];
    }
  }
}

/**
 * `models/schema.yml`: each model's description and the tests the author chose, per column. A
 * model with neither is omitted -- an empty entry is a warning in dbt's eyes -- and a model
 * described but untested has no `columns:`. The description is a YAML double-quoted string, so
 * a newline or a colon in it stays text; the contract has already refused the braces dbt would
 * render as Jinja (ADR 0137).
 */
function schemaYml(models: readonly TestedModel[]): string {
  const lines = ["version: 2", "", "models:"];
  const entries = models
    .map((model) => ({
      name: model.name,
      description: model.description,
      columns: Object.entries(model.tests.columns).filter(([, tests]) => tests.length > 0),
    }))
    .filter((model) => model.columns.length > 0 || model.description !== null);
  for (const model of entries) {
    lines.push(`  - name: ${yamlString(model.name)}`);
    if (model.description !== null) {
      lines.push(`    description: ${yamlString(model.description)}`);
    }
    if (model.columns.length > 0) {
      lines.push("    columns:");
    }
    for (const [column, tests] of model.columns) {
      lines.push(
        `      - name: ${yamlString(column)}`,
        "        data_tests:",
        ...tests.flatMap(columnTestLines),
      );
    }
  }
  if (entries.length === 0) {
    lines.push("  []");
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * The name of a model's SQL test as dbt knows it: its file under `tests/`, its `unique_id`
 * (`test.undercroft.<this>`, a singular test's carries no hash) and the relation its failing
 * rows are stored in under `dq_<slug>`. The model is everything before the LAST `__`, which a
 * test name can never contain (`SQL_TEST_NAME` in the contract), so the ledger can attribute
 * the step to its model by name when the manifest cannot (ADR 0130).
 */
export function sqlTestName(model: string, test: string): string {
  return `${model}${SQL_TEST_SEPARATOR}${test}`;
}

const SQL_TEST_SEPARATOR = "__";

/**
 * `tests/<model>__<name>.sql`: one dbt singular test. A warn test says so in its own config
 * block, the one config a test's text is given -- the author's SQL may not call `config()`
 * (`modelCheck.ts`), so where its failing rows go stays the project's `+schema: dq_<slug>`.
 */
function singularTest(test: SqlTestJson): string {
  const config = test.severity === "warn" ? "{{ config(severity = 'warn') }}\n" : "";
  return `${config}${test.sql}\n`;
}

/**
 * Every prefix a failing-rows relation of a test on `model` starts with, hashed or not: a
 * generic test's `<kind>_<model>_` (a truncated name keeps it whole when it is 30 characters or
 * fewer) and a SQL test's `<model>__`.
 */
export function testRelationPrefixes(model: string): string[] {
  return [
    ...GENERIC_TEST_KINDS.map((kind) => `${kind}_${model}_`),
    `${model}${SQL_TEST_SEPARATOR}`,
  ];
}

/** The generic tests whose failing-rows relations `testRelationPrefixes` knows the names of. */
const GENERIC_TEST_KINDS = ["not_null", "unique", "accepted_values", "relationships"] as const;

/**
 * A generic test's arguments as dbt 1.9 flattens them into its name: sorted by argument name,
 * `model` left out, a list as its items and a value as Python's `str` of it (`False`, not
 * `false`) -- `synthesize_generic_test_names`. Each is the text written in `schema.yml`, which
 * is why an accepted value is the escaped one and `to` the whole `ref(...)`.
 */
function testArguments(column: string, test: Exclude<ColumnTestJson, string>): string[] {
  switch (test.kind) {
    case "accepted_values": {
      const quote = test.quote !== false;
      const said = test.quote === undefined ? [] : [test.quote ? "True" : "False"];
      // column_name, quote, values
      return [column, ...said, ...(test.values ?? []).map((v) => sqlQuotedValue(v, quote))];
    }
    case "relationships":
      // column_name, field, to
      return [column, test.field ?? "", refOf(test.to ?? "")];
    default:
      return [column];
  }
}

function testRelationName(kind: string, model: string, args: readonly string[]): string {
  // dbt replaces every run of characters outside [0-9a-zA-Z_] in an argument with one `_`.
  const flat = args.map((arg) => arg.replaceAll(NOT_IN_A_TEST_NAME, "_")).join("__");
  const full = `${kind}_${model}_${flat}`;
  if (full.length < LONG_TEST_NAME) {
    return full;
  }
  const hash = createHash("md5").update(full, "utf8").digest("hex");
  return `${`${kind}_${model}`.slice(0, TEST_NAME_KEPT)}_${hash}`;
}

/**
 * Every test file of the project: `models/schema.yml` and one `tests/<model>__<name>.sql` per
 * SQL test, keyed by path relative to the project root.
 */
export function testFiles(models: readonly TestedModel[]): Record<string, string> {
  const files: Record<string, string> = { "models/schema.yml": schemaYml(models) };
  for (const model of models) {
    for (const test of model.tests.sql ?? []) {
      files[`tests/${sqlTestName(model.name, test.name)}.sql`] = singularTest(test);
    }
  }
  return files;
}

/**
 * The relation each of the model's declared tests stores its failing rows in. dbt 1.9 names a
 * generic test `<kind>_<model>_<arguments>` (`synthesize_generic_test_names`) and, at 64
 * characters or more, keeps the first 30 of `<kind>_<model>` and appends the md5 of the full
 * name -- the only form in which Postgres would not cut the name itself. A SQL test is its own
 * name, `<model>__<name>`, which the check holds to 63 characters.
 */
export function testRelations(model: Pick<TestedModel, "name" | "tests">): string[] {
  const generic = Object.entries(model.tests.columns).flatMap(([column, tests]) =>
    tests.map((test) =>
      typeof test === "string"
        ? testRelationName(test, model.name, [column])
        : testRelationName(test.kind, model.name, testArguments(column, test)),
    ),
  );
  const singular = (model.tests.sql ?? []).map((test) => sqlTestName(model.name, test.name));
  return [...generic, ...singular];
}
