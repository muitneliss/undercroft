/**
 * What a reader is shown of a model's columns (ADR 0143): every one but those their grants hide.
 *
 * A hidden column is one Postgres refuses them -- named, or through `SELECT *` -- so listing it in
 * `models.list`, `models.get` or `seeds.get` would invite a query that cannot run, and name what
 * the rule exists to keep from them. Hiding is a list of what to hide, so a column a later build
 * adds is shown until somebody hides it, here as in the database.
 */

import type { ModelTests } from "@undercroft/contracts";

/** `columns` less the hidden ones, in their own order. */
export function shownColumns(columns: readonly string[], hidden: readonly string[]): string[] {
  return columns.filter((column) => !hidden.includes(column));
}

/** A model's column tests less those on a hidden column, which would name it. */
export function shownTests(tests: ModelTests, hidden: readonly string[]): ModelTests {
  if (hidden.length === 0) {
    return tests;
  }
  return {
    ...tests,
    columns: Object.fromEntries(
      Object.entries(tests.columns).filter(([column]) => !hidden.includes(column)),
    ),
  };
}
