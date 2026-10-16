/**
 * Row and column rules on a model grant (ADR 0143), as one algebra every door shares: what a rule
 * is, what several grants on one model reach together, what two reaches both allow, whether one
 * gives no more than another, and the canonical key of a set of them.
 *
 * Its own module so `access.ts` stays the grammar of objects and reach; it is re-exported there,
 * and imported through `@undercroft/contracts/access` by the browser, the control plane and the
 * worker alike. Like that entry point it imports nothing, so a browser bundle can read it.
 */

/**
 * A grant on one model may say how much of it it gives: a ROW RULE -- one or more conditions, all
 * of which a row must meet -- and HIDDEN COLUMNS, which the holder may not read. A rule narrows
 * the grant it belongs to and nothing else; `model:*`, a raw stream and a report carry none.
 *
 * What a reader then reads of a model is the UNION over every grant that reaches them on it, the
 * way every other grant adds (`unionOf`): one grant with no row rule is every row, `model:*` is
 * the whole model, and the columns they see are every column some grant lets them see. So a
 * built-in role, which holds `model:*`, is never narrowed.
 *
 * Enforced by the database, never by a filter here: the reader's scope login is granted only the
 * columns they see, and a row-level policy TO that login shows only the rows they see
 * (`repeatable/010_provision_tenant.sql`). A hidden column is REFUSED, not blanked -- an empty
 * value would pass for a real one (CLAUDE.md, rule 2).
 *
 * The bounds below are the database's too (`630_grant_rules.sql`), and a value is compared with
 * its column's own type when the rule is applied.
 */
export const ROW_OPS = ["eq", "in"] as const;
export type RowOp = (typeof ROW_OPS)[number];

/** A column a rule names: an identifier, as Postgres and dbt spell one unquoted or quoted. */
export const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;
export const MAX_RULE_CONDITIONS = 10;
export const MAX_RULE_VALUES = 100;
export const MAX_RULE_VALUE_CHARS = 200;
export const MAX_HIDDEN_COLUMNS = 200;

/** One condition of a row rule: the row's `column` is one of `values` (`eq`: exactly one). */
export interface RowCondition {
  readonly column: string;
  readonly op: RowOp;
  readonly values: readonly string[];
}

/** One grant's row rule: conditions a row must ALL meet. */
export type RowRule = readonly RowCondition[];

/** What one grant on one model says of it beyond the model: its row rule and hidden columns. */
export interface GrantRules {
  /** `null`: every row. */
  readonly rows: RowRule | null;
  readonly hidden: readonly string[];
}

/**
 * How much of one model a reader reaches: the rows -- `null` for every row, else the rows meeting
 * ANY ONE of these rules -- and the columns they may not read.
 */
export interface Narrowing {
  readonly rows: readonly RowRule[] | null;
  readonly hidden: readonly string[];
}

/** One model a reader reaches only part of, and how much. */
export interface ModelLimit extends Narrowing {
  readonly model: string;
}

/** How much of a model one grant gives, from its rules: `null` for a grant on the whole model. */
export function narrowingOf(rules: GrantRules | null | undefined): Narrowing | null {
  if (rules === null || rules === undefined) {
    return null;
  }
  if (rules.rows === null && rules.hidden.length === 0) {
    return null;
  }
  return { rows: rules.rows === null ? null : [rules.rows], hidden: [...rules.hidden] };
}

/** The value set of a condition, deduplicated and sorted: `eq` is `in` with one value. */
function valueSet(condition: RowCondition): string[] {
  return [...new Set(condition.values)].sort();
}

/** A rule as one text, whatever order its conditions and values were written in. */
function ruleText(rule: RowRule): string {
  const conditions = rule.map((condition) =>
    JSON.stringify([condition.column, valueSet(condition)]),
  );
  return JSON.stringify([...new Set(conditions)].sort());
}

/** Rules deduplicated by what they say. */
function distinctRules(rules: readonly RowRule[]): RowRule[] {
  const byText = new Map<string, RowRule>();
  for (const rule of rules) {
    byText.set(ruleText(rule), rule);
  }
  return [...byText.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, rule]) => rule);
}

/**
 * What several grants on one model reach together: every row if any reaches every row, else the
 * rows any of them reaches; and only the columns every one of them hides stay hidden. `null`, the
 * whole model, when nothing is left narrowed -- and whenever one of them is the whole model.
 */
export function unionOf(narrowings: readonly (Narrowing | null)[]): Narrowing | null {
  if (narrowings.length === 0 || narrowings.includes(null)) {
    return null;
  }
  const all = narrowings.filter((narrowing): narrowing is Narrowing => narrowing !== null);
  const rows = all.some((narrowing) => narrowing.rows === null)
    ? null
    : distinctRules(all.flatMap((narrowing) => narrowing.rows ?? []));
  const [first, ...rest] = all;
  const hidden = (first?.hidden ?? []).filter((column) =>
    rest.every((narrowing) => narrowing.hidden.includes(column)),
  );
  return rows === null && hidden.length === 0
    ? null
    : { rows, hidden: [...new Set(hidden)].sort() };
}

/**
 * What both of two narrowings let a reader read: a row must meet one rule of each, so each rule of
 * one is joined with each of the other; a column hidden by either stays hidden. What an export
 * downloads under, between what its asker read when they asked and what they read now.
 */
export function intersectionOf(a: Narrowing | null, b: Narrowing | null): Narrowing | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  let rows: RowRule[] | null;
  if (a.rows === null) {
    rows = b.rows === null ? null : [...b.rows];
  } else if (b.rows === null) {
    rows = [...a.rows];
  } else {
    const bRows = b.rows;
    rows = distinctRules(a.rows.flatMap((left) => bRows.map((right) => [...left, ...right])));
  }
  const hidden = [...new Set([...a.hidden, ...b.hidden])].sort();
  return rows === null && hidden.length === 0 ? null : { rows, hidden };
}

/**
 * Whether a row meeting `given` must meet `held`: every condition of `held` is implied by one of
 * `given` on the same column with values among the held ones. Sound, not complete -- a rule
 * written another way that happens to say the same may be refused, never the reverse.
 */
function implies(given: RowRule, held: RowRule): boolean {
  return held.every((need) =>
    given.some(
      (has) =>
        has.column === need.column && has.values.every((value) => need.values.includes(value)),
    ),
  );
}

/**
 * Whether `given` reaches no more of a model than `held` does -- the subset rule's question about
 * one model (ADR 0143): every row `given` shows, `held` shows (each of its rules implies one of
 * `held`'s), and every column `held` hides, `given` hides. `null` is the whole model.
 */
export function isWithin(given: Narrowing | null, held: Narrowing | null): boolean {
  if (held === null) {
    return true;
  }
  if (given === null) {
    return false;
  }
  const heldRows = held.rows;
  const rows =
    heldRows === null ||
    (given.rows?.every((rule) => heldRows.some((allowed) => implies(rule, allowed))) ?? false);
  return rows && held.hidden.every((column) => given.hidden.includes(column));
}

/**
 * The limits of a scope in one canonical text -- each model's rules and hidden columns
 * deduplicated and sorted, a limit that narrows nothing dropped -- so one set of rules is one key
 * whatever order the grants were read in. The worker keys a scope login's password lease by it
 * (ADR 0087): it must name one login exactly as `ops.scope_limits` and the scope's hash do, and it
 * reads the same set by the same rules.
 */
export function scopeKey(scope: {
  readonly models: readonly string[];
  readonly limits: readonly ModelLimit[];
}): string {
  const models = [...new Set(scope.models)].sort();
  const limits = scope.limits
    .map((limit) => {
      const rows =
        limit.rows === null ? null : [...new Set(limit.rows.map((rule) => ruleText(rule)))].sort();
      return { model: limit.model, rows, hidden: [...new Set(limit.hidden)].sort() };
    })
    .filter((limit) => limit.rows !== null || limit.hidden.length > 0)
    .sort((a, b) => (a.model < b.model ? -1 : 1));
  return JSON.stringify({ models, limits });
}
