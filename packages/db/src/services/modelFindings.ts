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
  | "test-column-unmentioned";

export type Severity = "error" | "warning";

export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  /** 1-based, the author's own line; `null` for a finding about the model as a whole. */
  readonly line: number | null;
  /** What the finding is about -- a keyword, a model, a column -- when it names one. */
  readonly subject: string | null;
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
};

/** What text alone cannot show, always reported: rule 2, no evidence is not a pass. */
export const UNVERIFIED: readonly UnverifiedCode[] = [
  "compiles",
  "payload-keys",
  "column-types",
  "tests-pass",
  "function-effects",
];

/** Words that make a statement a write, wherever they stand -- a CTE included. */
export function finding(code: FindingCode, line: number | null, subject: string | null): Finding {
  return { code, severity: SEVERITY[code], line, subject };
}
