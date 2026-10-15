/**
 * What a customer-authored dbt model is allowed to be.
 *
 * The name is dbt's relation name and a Postgres identifier at once, so it is a plain
 * lowercase identifier and nothing else: `stg_deals`, never `Deals` or `1x` or `a-b`. The
 * tests are dbt generic tests keyed by column name under the same identifier rule, plus the
 * model's own SQL tests (ADR 0130), and the shape is what `app.model.tests` stores and what
 * the worker turns into `schema.yml` and `tests/`.
 *
 * Shared by the control plane (which validates a save), the worker (which writes the
 * project) and the browser (which refuses a bad name before it is sent).
 */

import { z } from "zod";

/** A dbt model or column name: what Postgres accepts unquoted and dbt accepts as a node. */
export const MODEL_NAME = /^[a-z][a-z0-9_]*$/u;

/** NAMEDATALEN - 1: the longest identifier Postgres keeps whole. */
export const MAX_IDENTIFIER_CHARS = 63;

export const ModelName = z.string().regex(MODEL_NAME).max(MAX_IDENTIFIER_CHARS);
export type ModelName = z.infer<typeof ModelName>;

/**
 * One model to build, as dbt selects it: `stg_deals` (the model), `+stg_deals` (it and every
 * model upstream of it) or `stg_deals+` (it and every model downstream). Nothing else of dbt's
 * selector grammar -- no `tag:`, no `path:`, no `@`, no wildcard -- because each of those reaches
 * further than a person can read off the names, and because the name inside is checked to be a
 * model of the tenant before dbt runs: a selector that matches nothing is a dbt build that
 * succeeds having built nothing, which is the answer this refuses to give (issue 442).
 *
 * The regex is the whole guard on what reaches dbt's argv: one optional `+` on one side of a
 * plain identifier, so no selector can be read as a flag or split into two.
 */
const MODEL_SELECTOR = /^(?:\+?[a-z][a-z0-9_]*|[a-z][a-z0-9_]*\+)$/u;

export const ModelSelector = z
  .string()
  .regex(MODEL_SELECTOR)
  // The identifier inside keeps Postgres's limit; the one `+` is the only character beyond it.
  .max(MAX_IDENTIFIER_CHARS + 1);
export type ModelSelector = z.infer<typeof ModelSelector>;

/** The most selectors one build takes: a handful of related models, not the whole project. */
export const MAX_BUILD_SELECTORS = 20;

/** The model a selector names, without its `+`: `+stg_deals` and `stg_deals+` are `stg_deals`. */
export function selectedModel(selector: ModelSelector): ModelName {
  return selector.replaceAll("+", "");
}

/**
 * The tests a column takes in their SHORT form, a bare kind: what the editor's form offers as
 * checkboxes, and the only shape a model's tests had before ADR 0130. Every stored row is
 * still in this shape, so it is a form `ColumnTest` reads as it always did, never a migration.
 */
export const TEST_KINDS = ["not_null", "unique"] as const;
export const TestKind = z.enum(TEST_KINDS);
export type TestKind = z.infer<typeof TestKind>;

/** Every dbt generic test a column may declare: the short kinds and the two with arguments. */
export const GENERIC_TEST_KINDS = [...TEST_KINDS, "accepted_values", "relationships"] as const;
export type GenericTestKind = (typeof GENERIC_TEST_KINDS)[number];

/**
 * What a failing test does to the build. `error` (dbt's default) fails the run and skips what
 * reads the model; `warn` is recorded as a warning -- visible, never failed, never a pass.
 */
export const TEST_SEVERITIES = ["error", "warn"] as const;
export const TestSeverity = z.enum(TEST_SEVERITIES);
export type TestSeverity = z.infer<typeof TestSeverity>;

/** The most values one `accepted_values` test lists: an enumeration, not a lookup table. */
export const MAX_ACCEPTED_VALUES = 100;
/** The longest accepted value: a status code or a label, not a paragraph. */
export const MAX_ACCEPTED_VALUE_CHARS = 200;
/** The most tests one column declares: one of each generic kind. */
const MAX_COLUMN_TESTS = GENERIC_TEST_KINDS.length;
/** The most SQL tests one model holds. A rule each, not a test suite. */
export const MAX_SQL_TESTS = 50;
/** The most SQL one SQL test may hold: one SELECT of the violating rows. */
export const MAX_SQL_TEST_BYTES = 16 * 1024;

/**
 * An accepted value, as text, always. dbt renders the list into the test's SQL with no escaping
 * and through Jinja, so a brace (a Jinja delimiter) or a control character is refused here; a
 * single quote is doubled where the YAML is written (`dbtProject.ts`).
 */
const ACCEPTED_VALUE = /^[^{}\p{Cc}]*$/u;
/**
 * The only values `quote: false` admits: a plain decimal, spliced into SQL bare. Still a
 * string -- a money-like value is never read into a `number` (`money.md`); dbt writes the text.
 */
const UNQUOTED_VALUE = /^-?[0-9]+(?:\.[0-9]+)?$/u;

const AcceptedValue = z.string().max(MAX_ACCEPTED_VALUE_CHARS).regex(ACCEPTED_VALUE);

const severity = { severity: TestSeverity.optional() };

const NotNullTest = z.object({ kind: z.literal("not_null"), ...severity }).strict();
const UniqueTest = z.object({ kind: z.literal("unique"), ...severity }).strict();
const AcceptedValuesTest = z
  .object({
    kind: z.literal("accepted_values"),
    values: z.array(AcceptedValue).min(1).max(MAX_ACCEPTED_VALUES),
    /** `false` writes each value bare, for a numeric column; each must then be a decimal. */
    quote: z.boolean().optional(),
    ...severity,
  })
  .strict();

/** Whether a column test is `accepted_values` with `quote: false` and a value that is no decimal. */
function unquotedNonDecimal(declared: ColumnTest): boolean {
  return (
    typeof declared !== "string" &&
    declared.kind === "accepted_values" &&
    declared.quote === false &&
    !declared.values.every((value) => UNQUOTED_VALUE.test(value))
  );
}
/**
 * Every value of the column is a value of `field` in the model `to` (dbt's `relationships`).
 * `to` is a model -- or a seed, which `ref()` reaches the same way -- of the tenant, by name.
 */
const RelationshipsTest = z
  .object({ kind: z.literal("relationships"), to: ModelName, field: ModelName, ...severity })
  .strict();

/** One column test: a bare kind (the short form) or an object naming its kind. */
export const ColumnTest = z.union([
  TestKind,
  z.discriminatedUnion("kind", [NotNullTest, UniqueTest, AcceptedValuesTest, RelationshipsTest]),
]);
export type ColumnTest = z.infer<typeof ColumnTest>;

/** The kind of a column test, whichever form it is written in. */
export function kindOf(test: ColumnTest): GenericTestKind {
  return typeof test === "string" ? test : test.kind;
}

/**
 * A SQL test's name: lowercase words joined by single underscores. Never `__`, because the
 * test is written as `<model>__<name>` and the model is read back as everything before the
 * LAST `__` -- which a name with one in it would make ambiguous.
 */
export const SQL_TEST_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

/**
 * A rule as a query: a SELECT returning the rows that break it, which pass when it returns
 * none. Rendered as a dbt singular test (ADR 0130); its failing rows land in `dq_<slug>`.
 */
export const SqlTest = z
  .object({
    name: z.string().regex(SQL_TEST_NAME).max(MAX_IDENTIFIER_CHARS),
    sql: z.string().min(1).max(MAX_SQL_TEST_BYTES),
    ...severity,
  })
  .strict();
export type SqlTest = z.infer<typeof SqlTest>;

/**
 * `{"columns": {"deal_id": ["not_null", "unique"]}}`, plus, since ADR 0130, argument-carrying
 * column tests and model-level SQL tests:
 *
 *     {"columns": {"status": [{"kind": "accepted_values", "values": ["open", "paid"]}]},
 *      "sql": [{"name": "total_matches_lines", "sql": "select ...", "severity": "warn"}]}
 *
 * Empty is a model with no tests. A column takes each kind once, and SQL test names are
 * unique within the model: two of either would be two dbt tests of one name, which fails the
 * whole project's compile rather than this model's test.
 */
export const ModelTests = z
  .object({
    columns: z.record(ModelName, z.array(ColumnTest).max(MAX_COLUMN_TESTS)).default({}),
    sql: z.array(SqlTest).max(MAX_SQL_TESTS).optional(),
  })
  .strict()
  .superRefine((tests, ctx) => {
    for (const [column, list] of Object.entries(tests.columns)) {
      const kinds = list.map(kindOf);
      if (new Set(kinds).size !== kinds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a column takes each test kind once",
          path: ["columns", column],
        });
      }
      if (list.some(unquotedNonDecimal)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "with quote: false every accepted value must be a plain decimal",
          path: ["columns", column],
        });
      }
    }
    const names = (tests.sql ?? []).map((test) => test.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SQL test names must be unique within the model",
        path: ["sql"],
      });
    }
  });
export type ModelTests = z.infer<typeof ModelTests>;

/** A column test with its default severity left unsaid, and in the short form when it can be. */
function canonicalColumnTest(test: ColumnTest): ColumnTest {
  if (typeof test === "string") {
    return test;
  }
  const { severity: said, ...rest } = test;
  const meant = said === "warn" ? { ...rest, severity: said } : rest;
  if ((meant.kind === "not_null" || meant.kind === "unique") && !("severity" in meant)) {
    return meant.kind;
  }
  return meant;
}

/**
 * The one spelling of what `tests` means, so the same tests are stored -- and hashed, and
 * compared by a no-op save (ADR 0127) -- the same however they were written: `{"kind":
 * "not_null"}` is `"not_null"`, `severity: "error"` is no severity, and no SQL tests is no
 * `sql` key, which is how every row saved before ADR 0130 already reads.
 */
export function canonicalTests(tests: ModelTests): ModelTests {
  const columns: Record<string, ColumnTest[]> = {};
  for (const [column, list] of Object.entries(tests.columns)) {
    columns[column] = list.map(canonicalColumnTest);
  }
  const sql = (tests.sql ?? []).map(({ severity: said, ...rest }) =>
    said === "warn" ? { ...rest, severity: said } : rest,
  );
  return sql.length === 0 ? { columns } : { columns, sql };
}

/** The most SQL one model may hold. A model is a projection, not a data file. */
export const MAX_MODEL_SQL_BYTES = 64 * 1024;

/** The longest description a model may carry: a paragraph about its rows, not a document. */
export const MAX_MODEL_DESCRIPTION_CHARS = 1000;

/**
 * Neither brace. dbt renders a model's `description` through Jinja when it parses the project,
 * so `{{ ... }}` in one would be run -- and a description that is not valid Jinja fails the
 * parse of the WHOLE project, every other model's build with it. The accepted values above
 * refuse braces for the same reason. A lone `{` is refused too: the ban is on the character,
 * which a reader can check, not on Jinja's grammar, which a reader would have to guess at.
 */
const NO_BRACES = /^[^{}]*$/u;

/**
 * What the model is, in its author's words: optional, written for the person reading the list,
 * the agent choosing a model, and dbt's own manifest. Nothing checks what it says (ADR 0137).
 */
export const ModelDescription = z
  .string()
  .trim()
  .min(1)
  .max(MAX_MODEL_DESCRIPTION_CHARS)
  .regex(NO_BRACES);
export type ModelDescription = z.infer<typeof ModelDescription>;
