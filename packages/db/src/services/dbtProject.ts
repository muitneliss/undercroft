/**
 * The dbt project the platform writes for one tenant, right before it builds it.
 *
 * There is no dbt project in the repository any more. What the platform ships is here, as
 * text: the source definition over `raw.records`, the two macros every model may use, and
 * the shape of a `dbt_project.yml` and a `profiles.yml`. What the customer wrote is in
 * `app.model`. `renderProject` joins the two into the files dbt reads, for a directory that
 * exists for one build and is removed after.
 *
 * Three things the rendering holds to:
 *
 * - **The password is never in a file.** `profiles.yml` reads it from the environment of
 *   the dbt process (`PASSWORD_VAR`), which the worker sets for that one child and nothing
 *   else. A temp directory that outlives a crash holds no credential.
 * - **The profile IS the tenant.** `user` is the tenant's own dbt login and `schema` its own
 *   analytics schema, so a model that names no schema lands in the right one and a model
 *   that names another tenant's is refused by Postgres, not by a convention.
 * - **`generate_schema_name` is overridden** so `+schema: dq_<slug>` means exactly that.
 *   dbt's default would render it `analytics_<slug>_dq_<slug>` -- the reason the old
 *   starter project never ran. Tests store their failing rows there; the BI role has no
 *   USAGE on it.
 *
 * `parseRunResults` is the other half: dbt's `run_results.json` as the ledger's steps, one
 * per model or test, with the failing-row count a test reported. Pure, so a fixture pins it.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: `not_null`, `run_results`, `execution_time` and `relation_name` are dbt's own names for its own things, read from a file dbt wrote; a camelCase spelling would be a second name for the same thing.

import type { RunStep } from "../repos/runs.ts";

/** The environment variable the generated profile reads the tenant's password from. */
export const PASSWORD_VAR = "UNDERCROFT_DBT_PASSWORD";

/** How many dbt threads one build gets. A tenant's project is small; the box is shared. */
const THREADS = 4;
/** dbt reports execution time in seconds; the ledger keeps milliseconds. */
const MS_PER_SECOND = 1000;

export const SOURCES_YML = `version: 2

# One source, one table. A new connector does NOT add a source here -- it filters
# raw.records by \`source\` and \`entity\`. The platform never learns a source's shape at the
# database level; the shape is asserted in your models, where you control it.
sources:
  - name: undercroft
    schema: raw
    tables:
      - name: records
        description: >
          Every source's records, one row per (source, tenant, entity, upstream id),
          projecting the newest observation in the lake. History lives in the lake.
          Row-level security shows this project its own tenant's rows and no others.
      - name: documents
        description: >
          The catalogue of byte documents -- mail attachments, files -- one row each.
          The bytes themselves stay in the lake.
`;

const PARSE_AMOUNT = `{#
    Read a money amount out of a jsonb payload as a fixed-precision numeric, or NULL.

    The same rule as the rest of the platform, in SQL: never a float, never a guess. A
    value that is not a clean number becomes NULL -- a visibly missing cell -- rather than
    0, which would be a fabricated fact indistinguishable from a real zero. The cast goes
    jsonb -> text -> numeric, never through \`double precision\`.
#}
{% macro parse_amount(payload, key) %}
    CASE
        WHEN ({{ payload }} ->> '{{ key }}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN ({{ payload }} ->> '{{ key }}')::numeric(18, 4)
        ELSE NULL
    END
{% endmacro %}
`;

const GENERATE_SCHEMA_NAME = `{#
    A custom schema name is used as written. dbt's default would prefix it with the
    target schema, turning \`dq_<slug>\` into \`analytics_<slug>_dq_<slug>\`. Models that
    name no schema land in the target schema: this tenant's own analytics schema.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
`;

/** The macros every tenant's project carries. Read-only from the editor's side. */
export const MACROS: readonly { name: string; sql: string }[] = [
  { name: "parse_amount", sql: PARSE_AMOUNT },
  { name: "generate_schema_name", sql: GENERATE_SCHEMA_NAME },
];

export interface ProjectModel {
  readonly name: string;
  readonly sql: string;
  readonly tests: { readonly columns: Record<string, readonly string[]> };
}

export interface DatabaseAddress {
  readonly host: string;
  readonly port: number;
  readonly dbname: string;
}

export interface ProjectInput {
  /** The tenant's slug, as `ops.tenant_slug` folds it: `case_0042`. */
  readonly slug: string;
  readonly models: readonly ProjectModel[];
  readonly database: DatabaseAddress;
}

/** A YAML scalar, double-quoted so a host name or a path cannot be read as syntax. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function projectYml(slug: string): string {
  return `name: undercroft
version: 1.0.0
config-version: 2

profile: undercroft

model-paths: ["models"]
macro-paths: ["macros"]

models:
  undercroft:
    +materialized: table

# A failing test stores its offending rows -- which contain source data -- in the tenant's
# dq schema, which the BI role has no USAGE on. See generate_schema_name.
data_tests:
  +store_failures: true
  +schema: dq_${slug}
`;
}

function profilesYml(slug: string, database: DatabaseAddress): string {
  return `undercroft:
  target: tenant
  outputs:
    tenant:
      type: postgres
      host: ${yamlString(database.host)}
      port: ${String(database.port)}
      dbname: ${yamlString(database.dbname)}
      user: undercroft_dbt_${slug}
      password: "{{ env_var('${PASSWORD_VAR}') }}"
      schema: analytics_${slug}
      threads: ${String(THREADS)}
`;
}

/** `models/schema.yml`: the tests the author chose, per column. Models with none are omitted. */
function schemaYml(models: readonly ProjectModel[]): string {
  const lines = ["version: 2", "", "models:"];
  const tested = models
    .map((model) => ({
      name: model.name,
      columns: Object.entries(model.tests.columns).filter(([, tests]) => tests.length > 0),
    }))
    .filter((model) => model.columns.length > 0);
  for (const model of tested) {
    lines.push(`  - name: ${model.name}`, "    columns:");
    for (const [column, tests] of model.columns) {
      lines.push(`      - name: ${column}`, `        data_tests: [${tests.join(", ")}]`);
    }
  }
  if (tested.length === 0) {
    lines.push("  []");
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Every file of the tenant's project, keyed by path relative to the project root.
 *
 * Model and column names have been validated against the contract's identifier rule
 * before they reach a row, and the slug is Postgres's own folding; nothing here is quoted
 * for YAML except the two values that come from configuration.
 */
export function renderProject(input: ProjectInput): Record<string, string> {
  const files: Record<string, string> = {
    "dbt_project.yml": projectYml(input.slug),
    "profiles.yml": profilesYml(input.slug, input.database),
    "models/sources.yml": SOURCES_YML,
    "models/schema.yml": schemaYml(input.models),
  };
  for (const macro of MACROS) {
    files[`macros/${macro.name}.sql`] = macro.sql;
  }
  for (const model of input.models) {
    files[`models/${model.name}.sql`] = model.sql;
  }
  return files;
}

interface RunResultsNode {
  readonly unique_id: string;
  readonly status: string;
  readonly message: string | null;
  readonly failures: number | null;
  readonly execution_time: number | null;
  readonly relation_name: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nodeOf(value: unknown): RunResultsNode | null {
  if (!isRecord(value) || typeof value.unique_id !== "string" || typeof value.status !== "string") {
    return null;
  }
  return {
    unique_id: value.unique_id,
    status: value.status,
    message: typeof value.message === "string" ? value.message : null,
    failures: typeof value.failures === "number" ? value.failures : null,
    execution_time: typeof value.execution_time === "number" ? value.execution_time : null,
    relation_name: typeof value.relation_name === "string" ? value.relation_name : null,
  };
}

/** `model.undercroft.stg_deals` -> `stg_deals`; `test.undercroft.not_null_x.a1b2` -> `not_null_x`. */
function stepOf(node: RunResultsNode): RunStep | null {
  const [kind, , name] = node.unique_id.split(".");
  if ((kind !== "model" && kind !== "test") || name === undefined || name === "") {
    return null;
  }
  return {
    uniqueId: node.unique_id,
    kind,
    name,
    status: node.status,
    failures: node.failures,
    relation: node.relation_name,
    message: node.message,
    executionMs:
      node.execution_time === null ? null : Math.round(node.execution_time * MS_PER_SECOND),
  };
}

/** A test that did not pass: it found rows, or it could not run at all. */
const TEST_FAILED = new Set(["fail", "error"]);

/**
 * dbt's `run_results.json` as the ledger's steps. Seeds, snapshots and operations are not
 * steps of ours and are skipped; a result that is not shaped like dbt's is skipped too
 * rather than guessed at.
 */
export function parseRunResults(json: unknown): { steps: RunStep[]; testsFailed: number } {
  const results = isRecord(json) && Array.isArray(json.results) ? json.results : [];
  const steps: RunStep[] = [];
  for (const raw of results) {
    const node = nodeOf(raw);
    const step = node === null ? null : stepOf(node);
    if (step !== null) {
      steps.push(step);
    }
  }
  const testsFailed = steps.filter((s) => s.kind === "test" && TEST_FAILED.has(s.status)).length;
  return { steps, testsFailed };
}
