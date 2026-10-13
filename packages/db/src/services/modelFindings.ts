/**
 * The vocabulary of `models.check` and `macros.check`: what a finding is, how severe each kind
 * is, and what a check can never verify. Its own module so the Jinja half (`modelCheck.ts`),
 * the SQL half (`sqlChecks.ts`) and a macro's definition (`macroDefinition.ts`) decide in one
 * set of words, and a new code is one entry in one table.
 */

import type { MacroRefusal } from "./macroDefinition.ts";

export type FindingCode =
  | MacroRefusal
  | "unbound-name"
  | "empty"
  | "semicolon"
  | "not-select"
  | "write-statement"
  | "select-into"
  | "raw-direct"
  | "analytics-direct"
  | "unknown-source"
  | "unknown-ref"
  | "self-ref"
  | "report-parameter"
  | "no-tombstone-filter"
  | "zero-default"
  | "top-level-limit"
  | "unknown-macro"
  | "dynamic-reference"
  | "test-column-unmentioned"
  | "test-forbidden-call"
  | "test-model-unread"
  | "test-name-too-long";

export type Severity = "error" | "warning";

export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  /** 1-based, the author's own line; `null` for a finding about the model as a whole. */
  readonly line: number | null;
  /** What the finding is about -- a keyword, a model, a column -- when it names one. */
  readonly subject: string | null;
  /**
   * The test whose text the finding is in, when it is not the model's SQL: a SQL test's name,
   * or `<column>.<kind>` for a column test. `line` is then that test's own line. ADR 0130.
   */
  readonly test?: string;
}

/** What text alone cannot show, in the order an author would run into it. */
export type UnverifiedCode =
  | "compiles"
  | "payload-keys"
  | "column-types"
  | "tests-pass"
  | "function-effects";

export interface ModelCheck {
  readonly findings: readonly Finding[];
  readonly unverified: readonly UnverifiedCode[];
}

/** Which codes block a save (`error`) and which the person must only see (`warning`). */
const SEVERITY: Readonly<Record<FindingCode, Severity>> = {
  // A macro's definition: `macros.save` refuses on any of these, so each is an error.
  "not-one-macro": "error",
  "name-mismatch": "error",
  "reserved-name": "error",
  "forbidden-block": "error",
  // A bare `{{ name }}` in a macro that is no parameter and nothing dbt defines: rendered as
  // an empty string, silently. A model's version of this is `report-parameter`.
  "unbound-name": "error",
  empty: "error",
  semicolon: "error",
  "not-select": "error",
  "write-statement": "error",
  "select-into": "error",
  "raw-direct": "error",
  "analytics-direct": "error",
  "unknown-source": "error",
  "unknown-ref": "error",
  "self-ref": "error",
  "report-parameter": "error",
  "no-tombstone-filter": "warning",
  "zero-default": "warning",
  "top-level-limit": "warning",
  "unknown-macro": "warning",
  "dynamic-reference": "warning",
  "test-column-unmentioned": "warning",
  // A SQL test (ADR 0130). Each is an error, and `models.save` refuses a test with any error:
  // a test runs as the tenant's dbt login with its failing rows written to dq, so a call that
  // runs SQL of its own or moves where those rows go is not a test.
  "test-forbidden-call": "error",
  // A test that reads its model through no `ref()` is neither built after it nor selected
  // with it, so it would judge a table the build has not made yet.
  "test-model-unread": "error",
  // `<model>__<name>` is a relation name: past 63 characters Postgres cuts it silently.
  "test-name-too-long": "error",
};

/** What text alone cannot show, always reported: rule 2, no evidence is not a pass. */
export const UNVERIFIED: readonly UnverifiedCode[] = [
  "compiles",
  "payload-keys",
  "column-types",
  "tests-pass",
  "function-effects",
];

export function finding(code: FindingCode, line: number | null, subject: string | null): Finding {
  return { code, severity: SEVERITY[code], line, subject };
}

/** The same finding, said to be about the test named `test` rather than the model's SQL. */
export function inTest(found: Finding, test: string): Finding {
  return { ...found, test };
}
