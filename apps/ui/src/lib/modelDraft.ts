/**
 * The model an author is editing, as the store holds it, and the two questions asked of it:
 * has it changed since it was saved, and what does the server get when it is.
 *
 * The draft carries a snapshot of what the server holds so "unsaved" is a comparison and
 * not a flag that has to be set at every edit and cleared at every save. Tests are kept as
 * a map of column to kinds, which is the shape a form edits; `testsFor` folds it into the
 * contract's shape at the one place it leaves the browser.
 */

// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { ModelTests, TestKind } from "@undercroft/contracts/models";

import type { ModelDetail } from "@/api/types.ts";

export type TestMap = Readonly<Record<string, readonly TestKind[]>>;

export interface ModelDraft {
  readonly tenantId: string;
  readonly name: string;
  readonly sql: string;
  readonly tests: TestMap;
  /** What the server holds, for the unsaved indicator. */
  readonly saved: { readonly sql: string; readonly tests: TestMap };
}

function isTestKind(value: string): value is TestKind {
  return value === "not_null" || value === "unique";
}

/** The server's test shape as the form edits it, with anything unknown left out. */
export function testMapOf(tests: ModelTests): TestMap {
  const map: Record<string, TestKind[]> = {};
  for (const [column, kinds] of Object.entries(tests.columns)) {
    map[column] = kinds.filter(isTestKind);
  }
  return map;
}

/** A draft seeded from what the server holds: nothing unsaved yet. */
export function draftFrom(tenantId: string, model: ModelDetail): ModelDraft {
  const tests = testMapOf(model.tests);
  return { tenantId, name: model.name, sql: model.sql, tests, saved: { sql: model.sql, tests } };
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

/** The draft's tests in the contract's shape, for `models.save`. */
export function testsFor(draft: ModelDraft): ModelTests {
  const columns: Record<string, TestKind[]> = {};
  for (const [column, kinds] of Object.entries(draft.tests)) {
    columns[column] = [...kinds];
  }
  return { columns };
}
