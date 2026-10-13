/**
 * The model an author is editing, as the store holds it, and the two questions asked of it:
 * has it changed since it was saved, and what does the server get when it is.
 *
 * The draft carries a snapshot of what the server holds so "unsaved" is a comparison and
 * not a flag that has to be set at every edit and cleared at every save. Tests are kept as
 * a map of column to kinds, which is the shape a form edits; `testsFor` folds it into the
 * contract's shape at the one place it leaves the browser.
 *
 * The form edits `not_null` and `unique` only. Every other test a model holds -- an
 * `accepted_values`, a `relationships`, a SQL test, a severity (ADR 0130) -- is carried through
 * untouched in `stored`, because a save from this editor replaces the model's tests whole and
 * would otherwise delete what the form cannot show.
 */

import {
  type ColumnTest,
  kindOf,
  type ModelTests,
  type TestKind,
} from "@undercroft/contracts/models";

import type { ModelDetail } from "@/api/types.ts";

export type TestMap = Readonly<Record<string, readonly TestKind[]>>;

export interface ModelDraft {
  readonly tenantId: string;
  readonly name: string;
  readonly sql: string;
  readonly tests: TestMap;
  /** What the server holds, for the unsaved indicator. */
  readonly saved: { readonly sql: string; readonly tests: TestMap };
  /** The tests the server holds in full, so a save keeps what the form does not edit. */
  readonly stored: ModelTests;
}

function isTestKind(value: string): value is TestKind {
  return value === "not_null" || value === "unique";
}

/** The server's test shape as the form edits it: each column's `not_null` and `unique`. */
export function testMapOf(tests: ModelTests): TestMap {
  const map: Record<string, TestKind[]> = {};
  for (const [column, list] of Object.entries(tests.columns)) {
    map[column] = list.map(kindOf).filter(isTestKind);
  }
  return map;
}

/** A draft seeded from what the server holds: nothing unsaved yet. */
export function draftFrom(tenantId: string, model: ModelDetail): ModelDraft {
  const tests = testMapOf(model.tests);
  return {
    tenantId,
    name: model.name,
    sql: model.sql,
    tests,
    saved: { sql: model.sql, tests },
    stored: model.tests,
  };
}

function sameTests(a: TestMap, b: TestMap): boolean {
  const columns = Object.keys(a);
  if (columns.length !== Object.keys(b).length) {
    return false;
  }
  return columns.every((column) => {
    const left = [...(a[column] ?? [])].sort();
    const right = [...(b[column] ?? [])].sort();
    return left.length === right.length && left.every((kind, i) => kind === right[i]);
  });
}

/** Whether the draft differs from what the server holds. Order of tests does not count. */
export function isDirty(draft: ModelDraft): boolean {
  return draft.sql !== draft.saved.sql || !sameTests(draft.tests, draft.saved.tests);
}

/**
 * The draft's tests in the contract's shape, for `models.save`: the form's kinds -- each in the
 * form the server stored it, so a `warn` on a checked `not_null` survives -- beside every test
 * the form does not edit, on whichever column holds it, and the model's SQL tests.
 */
export function testsFor(draft: ModelDraft): ModelTests {
  const stored = draft.stored.columns;
  const columns: Record<string, ColumnTest[]> = {};
  for (const [column, kinds] of Object.entries(draft.tests)) {
    const held = stored[column] ?? [];
    columns[column] = kinds.map((kind) => held.find((test) => kindOf(test) === kind) ?? kind);
  }
  for (const [column, held] of Object.entries(stored)) {
    const beyond = held.filter((test) => !isTestKind(kindOf(test)));
    if (beyond.length > 0) {
      columns[column] = [...(columns[column] ?? []), ...beyond];
    }
  }
  return draft.stored.sql === undefined ? { columns } : { columns, sql: draft.stored.sql };
}
