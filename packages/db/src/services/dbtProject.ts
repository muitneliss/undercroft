/**
 * The dbt project the platform writes for one tenant, right before it builds it.
 *
 * There is no dbt project in the repository any more. What the platform ships is here, as
 * text: the source definition over `raw.records`, the macros every project carries, and
 * the shape of a `dbt_project.yml` and a `profiles.yml`. What the customer wrote is in
 * `app.model`, `app.macro` and `app.seed`. `renderProject` joins the two into the files dbt
 * reads, for a directory that exists for one build and is removed after. The customer's macros
 * go under `macros/tenant/`, apart from the platform's, and every one is rendered on every
 * build: a macro is a helper any model may call, and which models call which is dbt's to
 * resolve. Every seed is rendered too, as `seeds/<name>.csv` with a `column_types` entry for
 * each of its columns (ADR 0128); which of them a build loads is its selection's to say.
 *
 * Three things the rendering holds to:
 *
 * - **The password is never in a file.** `profiles.yml` reads it from the environment of
 *   the dbt process (`PASSWORD_VAR`), which the worker sets for that one child and nothing
 *   else. A temp directory that outlives a crash holds no credential.
 * - **The profile IS the tenant.** `user` is the tenant's own dbt login and `schema` its own
 *   STAGING schema, so a model lands where no dashboard reads it until its tests pass, and a
 *   model that names another tenant's schema is refused by Postgres, not by a convention.
 * - **Write, audit, publish (ADR 0131).** dbt builds and tests every model in
 *   `staging_<slug>`; the worker then moves into `analytics_<slug>` only what passed
 *   (`promotion.ts`). A model never chooses its own schema -- `generate_schema_name` puts every
 *   model and seed in the target, whatever its config says, so none can write into analytics
 *   past its tests -- and `ref()` is overridden so a model this build does not select is read
 *   from analytics, where its last passing version is, and one it does select from staging,
 *   where its new rows are. A build of `fct` alone therefore reads `stg`'s published rows,
 *   never a version of `stg` that failed.
 * - **`generate_schema_name` is overridden** so a test's `+schema: dq_<slug>` means exactly
 *   that. dbt's default would render it `staging_<slug>_dq_<slug>`. Tests store their failing
 *   rows there; the BI role has no USAGE on it.
 *
 * `parseRunResults` is the other half: dbt's `run_results.json` as the ledger's steps, one
 * per model, test or seed, with the failing-row count a test reported. Pure, so a fixture pins
 * it.
 */

import type { ModelTestsJson } from "../repos/models.ts";
import type { RunStep, RunStepKind } from "../repos/runs.ts";
import { testFiles, testRelations } from "./dbtTests.ts";

/** The environment variable the generated profile reads the tenant's password from. */
export const PASSWORD_VAR = "UNDERCROFT_DBT_PASSWORD";

/**
 * How many dbt threads one build gets. A tenant's project is small; the box is shared. Each
 * thread holds a connection as the tenant's dbt login, through the pooler (ADR 0088), which
 * gives one login at most eight (`MAX_USER_CONNECTIONS` in the compose files) under the login's
 * own limit of ten (`repeatable/010_provision_tenant.sql`). A build takes about five of the
 * eight and sessions beside it queue for the rest: raise one, raise the others.
 */
const THREADS = 4;
/**
 * dbt's own login wait and retries. The pooler may queue a first login for a few seconds while
 * it opens a server connection; dbt's defaults (10 s, one retry) would fail the build instead.
 */
const CONNECT_TIMEOUT_S = 30;
const CONNECT_RETRIES = 3;
/** dbt reports execution time in seconds; the ledger keeps milliseconds. */
const MS_PER_SECOND = 1000;

export const SOURCES_YML = `version: 2

# One source, one table. A new connector does NOT add a source here -- it filters
# raw.records by \`source\` and \`entity\`. The platform never learns a source's shape at the
# database level; the shape is asserted in your models, where you control it.
#
# A second account of the same kind is its own source: the first Gmail mailbox lands as
# \`gmail\`, each one connected after it as \`<kind>.<account key>\` -- \`gmail.3fa9c1d2e0ab\`.
# A model filtering \`source = 'gmail'\` therefore sees the first mailbox only. The
# \`gmail_letters()\` macro folds every mailbox into one row per letter.
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
      - name: document_sheets
        description: >
          Every sheet of every landed workbook, one row each, keyed by the digest of the
          bytes it was read from -- join documents.sha256. Its name and tab order, kind,
          visibility, the workbook's 1904 date epoch, merged ranges, and whether the read is
          complete; when it is not, reason says why. ADR 0104.
      - name: document_rows
        description: >
          A sheet's non-empty rows: Excel's own row number, and cells, formats and faults as
          sparse JSON keyed by column letter. Every cell is the string the file stored; no
          header is chosen and no type inferred. Type a column in your model with
          parse_amount or excel_serial_date.
      - name: document_rows_refusal
        description: >
          Why a workbook whose text was read has no rows: the reader refused it when it was
          read again for them.
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
    Where a node lands. A model, a seed or a snapshot lands in the target schema -- this
    tenant's staging schema -- whatever schema its config names, because the platform, not
    the node, decides what is published: only what passed its tests is moved into analytics
    (ADR 0131). A test's custom schema is used as written, so \`dq_<slug>\` stays \`dq_<slug>\`;
    dbt's default would prefix it with the target schema.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none or node.resource_type != 'test' -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
`;

const GENERATE_ALIAS_NAME = `{#
    What a node's relation is called. A model or a seed is called by its own name, whatever
    alias its config names: the platform finds a build's relations by name -- to promote them
    (ADR 0131), to record their columns, to drop them with the model (ADR 0077) -- and an
    aliased model would build a table none of them looks for, held back from analytics on every
    build, with every child built over it. Any other node is named as dbt names it, by its name
    or its own alias -- the failing-rows tables of tests are named so (\`dbtTests.ts\`). Model
    versions, the one other case dbt's default handles, are not offered here.
#}
{% macro generate_alias_name(custom_alias_name=none, node=none) -%}
    {%- if custom_alias_name is none or node.resource_type == 'model'
          or node.resource_type == 'seed' -%}
        {{ node.name }}
    {%- else -%}
        {{ custom_alias_name | trim }}
    {%- endif -%}
{%- endmacro %}
`;

/** The project variable the `ref()` override reads the published schema from. */
const PUBLISHED_VAR = "undercroft_published_schema";

/**
 * `ref()`, so a build reads each parent where the right version of it is (ADR 0131).
 *
 * A parent this build selects is built and tested in staging before its children, and dbt
 * skips the children when it fails: they read it from staging, the new rows. A parent the
 * build does not select is read from the published schema, its last passing version: staging
 * may hold nothing of it, or a version whose tests failed. `selected_resources` is empty while
 * dbt parses, which is when `builtins.ref` records the dependency, so the parse is untouched;
 * the swap happens only when the SQL is rendered to run (`execute`).
 *
 * Not one of `MACROS`: those are offered to authors and read by the lineage as helpers a model
 * calls, and this is dbt's own `ref` -- every model already calls it.
 */
const REF_OVERRIDE = `{#
    ref(), reading a parent this build does not select from the published schema (ADR 0131).
#}
{% macro ref() -%}
    {%- set relation = builtins.ref(*varargs, **kwargs) -%}
    {%- set name = varargs | last -%}
    {%- if execute and relation is not none and relation.schema == target.schema
          and ('model.undercroft.' ~ name) not in selected_resources
          and ('seed.undercroft.' ~ name) not in selected_resources -%}
        {%- do return(relation.incorporate(path={'schema': var('${PUBLISHED_VAR}')})) -%}
    {%- endif -%}
    {%- do return(relation) -%}
{%- endmacro %}
`;

/** The three headers two copies of one letter must agree on, as `lower()` folds their keys. */
const COMPARED_HEADERS = ["from", "subject", "date"] as const;

/**
 * Whether the copies of one letter disagree about a header, NULL taken as a value.
 *
 * `count(DISTINCT ...)` alone skips NULLs, so a copy carrying `Subject: Invoice 7` beside a
 * copy carrying no Subject at all would read as agreement. The collector asks every mailbox
 * for the same headers, so that is two different messages under one Message-ID -- exactly
 * what the flag is for -- and it counts as a conflict. Copies that ALL lack the header
 * agree: there is nothing to disagree about. Values are compared as written, untrimmed.
 */
function disagree(header: string): string {
  const column = `m.header_${header}`;
  return `(count(DISTINCT ${column}) > 1 OR (count(${column}) > 0 AND count(${column}) < count(*)))`;
}

/**
 * Every live Gmail letter of `relation` once, however many of a tenant's mailboxes hold it,
 * as a parenthesised subquery: `SELECT * FROM <this> l`.
 *
 * `relation` is spliced in as written. The shipped macro passes dbt's `source()` call and
 * the offline suite passes `raw.records`, so both run this one text; nothing else in it is
 * Jinja, which `dbtProject.test.ts` pins.
 *
 * The grouping is on the letter key AND the Message-ID, not on the key alone. An anchorless
 * key is `<source>:<gmail id>`, and a sender writes their own Message-ID -- one spelled
 * `gmail:<some id>` would otherwise fuse a stranger's letter into one of ours. Grouped on
 * both, the two key spaces cannot meet: a collision surfaces as two rows sharing a key,
 * which a `unique` test sees, rather than one row that is silently two letters.
 *
 * The header lookup is one aggregate pass per row, `max(...) FILTER`, rather than a
 * `LIMIT 1` subquery per header: it is deterministic if a legacy row ever held two spellings
 * of one key, and an aggregate with no GROUP BY answers once even over no headers, so a row
 * whose `headers` is absent or not an object is kept -- as an anchorless letter -- rather
 * than dropped by the lateral join or failing the whole build inside `jsonb_each_text`.
 */
export function gmailLettersSql(relation: string): string {
  const headerColumns = COMPARED_HEADERS.map(
    (header) => `max(e.value) FILTER (WHERE lower(e.key) = '${header}') AS header_${header}`,
  ).join(",\n                ");
  const passThrough = COMPARED_HEADERS.map((header) => `h.header_${header}`).join(", ");
  const conflict = COMPARED_HEADERS.map(disagree).join("\n            OR ");
  return `(
    SELECT
        m.tenant_id,
        m.letter_key,
        m.rfc822_message_id,
        count(*)::integer AS copies,
        array_agg(m.source ORDER BY m.source, m.source_record_id) AS sources,
        array_agg(m.source_record_id ORDER BY m.source, m.source_record_id) AS message_ids,
        array_agg(m.thread_id ORDER BY m.source, m.source_record_id) AS thread_ids,
        min(m.source_updated_at) AS message_time,
        max(m.documents_landed) AS documents_landed,
        (
            ${conflict}
        ) AS headers_conflict
    FROM (
        SELECT
            r.tenant_id,
            r.source,
            r.source_record_id,
            r.payload ->> 'threadId' AS thread_id,
            r.source_updated_at,
            r.documents_landed,
            h.message_id AS rfc822_message_id,
            COALESCE(h.message_id, r.source || ':' || r.source_record_id) AS letter_key,
            ${passThrough}
        FROM ${relation} AS r
        CROSS JOIN LATERAL (
            SELECT
                NULLIF(btrim(max(e.value) FILTER (WHERE lower(e.key) = 'message-id')), '') AS message_id,
                ${headerColumns}
            FROM jsonb_each_text(
                CASE WHEN jsonb_typeof(r.payload -> 'headers') = 'object' THEN r.payload -> 'headers' END
            ) AS e (key, value)
        ) AS h
        WHERE (r.source = 'gmail' OR r.source LIKE 'gmail.%')
          AND r.entity = 'messages'
          AND r.deleted_at IS NULL
    ) AS m
    GROUP BY m.tenant_id, m.letter_key, m.rfc822_message_id
)`;
}

const GMAIL_LETTERS = `{#
    Every Gmail letter once, however many of this tenant's mailboxes received it:
    select * from {{ gmail_letters() }} l

    The first mailbox lands as source 'gmail', each one added after it as 'gmail.<account
    key>'. Gmail's message and thread ids belong to one mailbox, so the same letter in two
    mailboxes carries unrelated ids; the lists keep every copy's, ordered by source.

    Rule 1 -- a letter is its RFC 5322 Message-ID, read whatever case the header key was
    written in. A letter WITHOUT one stands alone, keyed on its own mailbox's id: grouping
    on the blank would fuse every such letter into one message that never existed.

    Rule 2 -- evidence found in one copy belongs to the letter. documents_landed is the
    strongest copy's count, and NULL only when no copy said.

    headers_conflict is true when the copies disagree on From, Subject or Date, a header
    one copy carries and another lacks included. It is a question for a person, not a
    verdict: the copies are still folded, and the column says they should be looked at.
#}
{% macro gmail_letters() %}
${gmailLettersSql("{{ source('undercroft', 'records') }}")}
{% endmacro %}
`;

/** An Excel serial: whole days, at most seven digits (9999-12-31 is 2,958,465). */
const SERIAL_DAYS = "^[0-9]{1,7}$";
const SERIAL_DAYS_AND_TIME = "^[0-9]{1,7}([.][0-9]+)?$";

/**
 * The date an Excel serial stands for, or NULL: `value` and `date1904` are SQL expressions
 * spliced in as written -- the text of a cell, and the workbook's epoch flag.
 *
 * Exact, and NULL rather than a guess wherever the answer is not one (`CLAUDE.md` rule 2):
 * - an epoch the workbook did not state (NULL) dates nothing;
 * - in the 1900 system serial 60 is 1900-02-29, a day that never existed -- Excel kept Lotus
 *   1-2-3's leap-year bug -- so it is NULL, and serials before it count from 1899-12-31 while
 *   those after count from 1899-12-30; serial 0 is "1900-01-00" and NULL too;
 * - the 1904 system counts from 1904-01-01, serial 0 included;
 * - anything but whole days is NULL: a fraction is a time, `excel_serial_timestamp`'s.
 *
 * Plain SQL with no Jinja of its own, so `excelSerial.test.ts` runs this very text.
 */
export function excelSerialDateSql(value: string, date1904: string): string {
  return `(CASE
        WHEN (${date1904}) IS NULL OR (${value}) IS NULL OR (${value}) !~ '${SERIAL_DAYS}' THEN NULL
        WHEN (${date1904}) THEN DATE '1904-01-01' + (${value})::integer
        WHEN (${value})::integer >= 61 THEN DATE '1899-12-30' + (${value})::integer
        WHEN (${value})::integer BETWEEN 1 AND 59 THEN DATE '1899-12-31' + (${value})::integer
        ELSE NULL
    END)`;
}

/**
 * The timestamp an Excel serial stands for, to the millisecond, with no time zone attached --
 * Excel stores none, and choosing one is not this platform's call (`i18n.md`). The whole days
 * are `excelSerialDateSql`'s, NULLs included; the fraction is the time of day, in numeric
 * arithmetic, never through a float.
 */
export function excelSerialTimestampSql(value: string, date1904: string): string {
  const days = `trunc((${value})::numeric)::text`;
  return `(CASE
        WHEN (${value}) IS NULL OR (${value}) !~ '${SERIAL_DAYS_AND_TIME}' THEN NULL
        ELSE ${excelSerialDateSql(days, date1904)}::timestamp
            + round(((${value})::numeric - trunc((${value})::numeric)) * 86400000)
              * interval '1 millisecond'
    END)`;
}

const EXCEL_SERIAL_DATE = `{#
    The date an Excel serial stands for -- a workbook cell stores a date as a count of days:
    select {{ excel_serial_date("r.cells ->> 'A'", 's.date1904') }} as booked_on
      from {{ source('undercroft', 'document_rows') }} r
      join {{ source('undercroft', 'document_sheets') }} s using (tenant_id, sha256, sheet_index)

    Pass the sheet's date1904 so a Mac workbook's dates are not four years out. NULL for
    anything that is not whole days, for 1900-02-29 (a day Excel invented), and when the
    epoch is unknown. Whether a column IS a date is your call: formats says how Excel showed it.
#}
{% macro excel_serial_date(value, date1904) %}
${excelSerialDateSql("{{ value }}", "{{ date1904 }}")}
{% endmacro %}
`;

const EXCEL_SERIAL_TIMESTAMP = `{#
    The timestamp an Excel serial stands for, whole days and the fraction that is the time of
    day, to the millisecond and with no time zone -- Excel stores none:
    select {{ excel_serial_timestamp("r.cells ->> 'B'", 's.date1904') }} as posted_at
#}
{% macro excel_serial_timestamp(value, date1904) %}
${excelSerialTimestampSql("{{ value }}", "{{ date1904 }}")}
{% endmacro %}
`;

/** The macros every tenant's project carries. Read-only from the editor's side. */
export const MACROS: readonly { name: string; sql: string }[] = [
  { name: "parse_amount", sql: PARSE_AMOUNT },
  { name: "generate_schema_name", sql: GENERATE_SCHEMA_NAME },
  { name: "generate_alias_name", sql: GENERATE_ALIAS_NAME },
  { name: "gmail_letters", sql: GMAIL_LETTERS },
  { name: "excel_serial_date", sql: EXCEL_SERIAL_DATE },
  { name: "excel_serial_timestamp", sql: EXCEL_SERIAL_TIMESTAMP },
];

export interface ProjectModel {
  readonly name: string;
  readonly sql: string;
  readonly tests: ModelTestsJson;
}

/** A tenant's macro: one whole `{% macro %}` definition, as `macroDefinition.ts` admitted it. */
export interface ProjectMacro {
  readonly name: string;
  readonly sql: string;
}

/**
 * A tenant's reference table as the project carries it: its declared columns, and the CSV text
 * `seedCsv` (`@undercroft/contracts`) wrote for the rows `seedRefusal` admitted.
 */
export interface ProjectSeed {
  readonly name: string;
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly csv: string;
  /**
   * Load it by dropping and re-creating its table, rather than by truncating and inserting. Set
   * when the table standing in the schema does not have the declared columns and types: an
   * insert into it would fail on a column it lacks, leave a removed column standing as NULLs,
   * or cast a cell into the column's OLD type. dbt drops it `cascade`, so this is set only then.
   */
  readonly fullRefresh: boolean;
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
  readonly macros: readonly ProjectMacro[];
  readonly seeds: readonly ProjectSeed[];
  readonly database: DatabaseAddress;
}

/** A YAML scalar, double-quoted so a host name or a path cannot be read as syntax. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The `seeds:` block: every seed's column types, so dbt reads every cell as text and Postgres
 * casts it into the declared type -- no type is inferred (ADR 0128) -- and, for a seed whose
 * standing table no longer matches, a full refresh. Column names are quoted as written, which
 * keeps a column called `order` a column. Every key is a quoted YAML string too: dbt reads YAML
 * 1.1, where a bare `on`, `no` or `null` -- each a valid identifier -- is a boolean or nothing,
 * and the seed or column it names would silently lose its declared type.
 */
function seedsYml(seeds: readonly ProjectSeed[]): string {
  const lines = ["seeds:", "  undercroft:", "    +quote_columns: true"];
  for (const seed of seeds) {
    lines.push(`    ${yamlString(seed.name)}:`, "      +column_types:");
    for (const column of seed.columns) {
      lines.push(`        ${yamlString(column.name)}: ${yamlString(column.type)}`);
    }
    if (seed.fullRefresh) {
      lines.push("      +full_refresh: true");
    }
  }
  return `${lines.join("\n")}\n`;
}

function projectYml(slug: string, seeds: readonly ProjectSeed[]): string {
  return `name: undercroft
version: 1.0.0
config-version: 2

profile: undercroft

# Where what passed its tests is promoted to, and where ref() reads a parent this build does
# not select (ADR 0131). The target schema, in profiles.yml, is staging.
vars:
  ${PUBLISHED_VAR}: analytics_${slug}

model-paths: ["models"]
macro-paths: ["macros"]
test-paths: ["tests"]
seed-paths: ["seeds"]

models:
  undercroft:
    +materialized: table

${seedsYml(seeds)}
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
      schema: staging_${slug}
      threads: ${String(THREADS)}
      connect_timeout: ${String(CONNECT_TIMEOUT_S)}
      retries: ${String(CONNECT_RETRIES)}
`;
}

/**
 * Every file of the tenant's project, keyed by path relative to the project root.
 *
 * Model, macro, seed and column names have been validated against the contract's identifier
 * rule before they reach a row, and the slug is Postgres's own folding. A valid identifier can
 * still be a YAML 1.1 boolean or null (`on`, `no`, `null`), so every name written as YAML -- the
 * seeds block (`seedsYml`) and `schema.yml` (`dbtTests.ts`) -- is a quoted string, as are the
 * values that come from configuration. A tenant's macro has its own directory, so its file can
 * never be one of the platform's whatever it is named -- and a name that would override one of
 * the platform's macros never reaches a row (`macroDefinition.ts`).
 */
export function renderProject(input: ProjectInput): Record<string, string> {
  const files: Record<string, string> = {
    "dbt_project.yml": projectYml(input.slug, input.seeds),
    "profiles.yml": profilesYml(input.slug, input.database),
    "models/sources.yml": SOURCES_YML,
    ...testFiles(input.models),
  };
  for (const macro of MACROS) {
    files[`macros/${macro.name}.sql`] = macro.sql;
  }
  files["macros/undercroft/ref.sql"] = REF_OVERRIDE;
  for (const macro of input.macros) {
    files[`macros/tenant/${macro.name}.sql`] = macro.sql;
  }
  for (const model of input.models) {
    files[`models/${model.name}.sql`] = model.sql;
  }
  for (const seed of input.seeds) {
    files[`seeds/${seed.name}.csv`] = seed.csv;
  }
  return files;
}

/** NAMEDATALEN - 1, and the length dbt-postgres fits every relation name it makes into. */
const MAX_RELATION_NAME = 63;
/** The working copies dbt-postgres 1.9 renames through when it replaces a relation. */
const WORKING_SUFFIXES = ["__dbt_tmp", "__dbt_backup"] as const;

/**
 * Where a build of this project puts what one model makes, named the way dbt names it.
 *
 * `built` is the model's own relation plus the two working copies dbt-postgres swaps through
 * when it replaces one (`make_relation_with_suffix`: the name cut to fit, then the suffix). The
 * same names stand in BOTH schemas a build writes: staging, where dbt builds and where a
 * version whose tests failed stays (ADR 0131), and analytics, where a promoted version is
 * moved and where builds before staging existed left theirs. The swap commits before the
 * backup is dropped, so a build killed between the two leaves `<name>__dbt_backup` holding the
 * previous rows, and only the next build of the same model would have cleared it.
 *
 * `dq` is where each of the model's declared tests stores its failing rows, which the project
 * above sends to `dq_<slug>` with `+store_failures`, named as `testRelations` (`dbtTests.ts`)
 * says dbt names them.
 *
 * Here beside `renderProject` because it is a statement about what that rendering produces;
 * a change to how tests are rendered is a change to this, and they should be read together.
 * Names only: whether each exists, and whose it is when two models' names could collide, is
 * the caller's to decide against the catalogue.
 */
export function relationsOfModel(model: Pick<ProjectModel, "name" | "tests">): {
  readonly built: string[];
  readonly dq: string[];
} {
  const built = [
    model.name,
    ...WORKING_SUFFIXES.map(
      (suffix) => `${model.name.slice(0, MAX_RELATION_NAME - suffix.length)}${suffix}`,
    ),
  ];
  return { built, dq: testRelations(model) };
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

const STEP_KINDS: ReadonlySet<string> = new Set<RunStepKind>(["model", "test", "seed"]);

function isStepKind(kind: string | undefined): kind is RunStepKind {
  return kind !== undefined && STEP_KINDS.has(kind);
}

/**
 * `model.undercroft.stg_deals` -> `stg_deals`; `test.undercroft.not_null_x.a1b2` -> `not_null_x`;
 * a SQL test's `test.undercroft.stg_deals__total_matches` (no hash) -> `stg_deals__total_matches`,
 * whose model is the part before the last `__` (`sqlTestName`);
 * `seed.undercroft.account_groups` -> `account_groups`.
 */
function stepOf(node: RunResultsNode): RunStep | null {
  const [kind, , name] = node.unique_id.split(".");
  if (!isStepKind(kind) || name === undefined || name === "") {
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

/**
 * A test that did not pass: it found rows, or it could not run at all. A `severity: warn` test
 * that found rows is dbt's status `warn` and is NOT here: it is recorded as the step's status,
 * visible, never counted failed and never folded into `pass` (ADR 0130).
 */
const TEST_FAILED = new Set(["fail", "error"]);

/**
 * dbt's `run_results.json` as the ledger's steps: its models, tests and seeds. A seed is a step
 * because a build that failed to load one is a failed build, and only a step can say so (ADR
 * 0128). Snapshots and operations are not steps of ours and are skipped; a result that is not
 * shaped like dbt's is skipped too rather than guessed at.
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
