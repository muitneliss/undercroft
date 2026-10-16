/**
 * A grant's row rule and hidden columns (ADR 0143) as the grant form writes them and as a reader
 * reads them: the draft turned into the request, and a rule turned into words.
 *
 * Pure, and `t` first (`.claude/rules/i18n.md`): what a rule MEANS is the server's, and the
 * database's to enforce; this only spells what the reader wrote and what the server answered.
 */

import { MAX_RULE_VALUES, type RowCondition, type RowRule } from "@undercroft/contracts/rowRules";
import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { RuleConditionDraft } from "@/store.ts";

/** A condition's values as typed: one to a line, blank lines and repeats dropped. */
function valuesOf(typed: string): string[] {
  return [
    ...new Set(
      typed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ];
}

/**
 * The row rule a draft says, or `null` when it says none -- and `"incomplete"` when one of its
 * conditions has no value, or an `eq` more than one. A half-written condition is never dropped:
 * dropping it would give MORE rows than the reader meant to.
 */
export function ruleOfDraft(
  conditions: readonly RuleConditionDraft[],
): RowRule | null | "incomplete" {
  if (conditions.length === 0) {
    return null;
  }
  const rule = conditions.map((condition) => ({
    column: condition.column,
    op: condition.op,
    values: valuesOf(condition.values),
  }));
  const incomplete = rule.some(
    (condition) =>
      condition.column === "" ||
      condition.values.length === 0 ||
      condition.values.length > MAX_RULE_VALUES ||
      (condition.op === "eq" && condition.values.length !== 1),
  );
  return incomplete ? "incomplete" : rule;
}

/** One condition in words: `dept = Sales`, `region is one of north, south`. */
export function conditionWords(t: TFunction, condition: RowCondition): string {
  return condition.op === "eq"
    ? t("grantRules.eqWords", { column: condition.column, value: condition.values[0] ?? "" })
    : t("grantRules.inWords", { column: condition.column, values: condition.values.join(", ") });
}

/**
 * One grant's rule in words: its conditions, all of which a row meets, joined as the reader's
 * language joins a list (`Intl.ListFormat`) -- "a và b", "a and b" -- rather than by a translated
 * "and" pasted between them, which only reads right in the language it was pasted in.
 */
export function ruleWords(t: TFunction, locale: Locale, rule: RowRule): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(
    rule.map((condition) => conditionWords(t, condition)),
  );
}

/** What rows a reader sees, in words: every row, or those meeting any one of the rules. */
export function rowsWords(t: TFunction, locale: Locale, rows: readonly RowRule[] | null): string {
  if (rows === null) {
    return t("grantRules.everyRow");
  }
  const rules = rows.map((rule) => ruleWords(t, locale, rule));
  return rules.length === 1
    ? (rules[0] ?? "")
    : new Intl.ListFormat(locale, { type: "disjunction" }).format(
        rules.map((rule) => t("grantRules.grouped", { rule })),
      );
}
