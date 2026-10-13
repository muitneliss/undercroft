/**
 * How a model's latest tests and a Reports answer's qualifiers read (issue 456, ADR 0129).
 *
 * The server decides the state -- `passing`, `failing` or `unknown`, from the tests of the build
 * serving the model's rows -- and this only words it. `unknown` is "no test record", marked as
 * absent and never as granted: the absence of a failing test is not a passing one (CLAUDE.md
 * rule 2). A qualifier is worded one whole sentence per fact, never assembled from fragments,
 * because Vietnamese and English do not share word order (`.claude/rules/i18n.md`).
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { AnswerQualifier, ModelItem } from "@/api/types.ts";
import type { CardFacts } from "@/lib/connectionState.ts";
import { formatCount } from "@/lib/money.ts";

type TestSummary = ModelItem["lastTests"];

const MARK: Readonly<Record<TestSummary["state"], CardFacts["mark"]>> = {
  passing: "granted",
  failing: "lapsed",
  unknown: "absent",
};

export function testsMark(state: TestSummary["state"]): CardFacts["mark"] {
  return MARK[state];
}

/** The state in words: passing, how many failing, or no test record. */
export function testsLabel(t: TFunction, locale: Locale, tests: TestSummary): string {
  switch (tests.state) {
    case "passing":
      return t("models.testsPassing");
    case "failing":
      return tests.failing === null
        ? t("models.testsFailingAny")
        : t("models.testsFailing", {
            count: tests.failing,
            countText: formatCount(tests.failing, locale),
          });
    default:
      return t("models.testsUnknown");
  }
}

/** How many tests warned, or `null` when none did or the state is unknown. */
export function warningsLabel(t: TFunction, locale: Locale, tests: TestSummary): string | null {
  if (tests.warnings === null || tests.warnings === 0) {
    return null;
  }
  return t("models.testsWarnings", {
    count: tests.warnings,
    countText: formatCount(tests.warnings, locale),
  });
}

/** The sentences one qualifier comes to, in order: what the table's tests say, then which. */
export function qualifierSentences(t: TFunction, qualifier: AnswerQualifier): string[] {
  if (qualifier.state === "unknown") {
    return [t("bi.qualifierUnknown", { table: qualifier.table })];
  }
  const head =
    qualifier.runId === null
      ? t("bi.qualifierFailingNoRun", { table: qualifier.table })
      : t("bi.qualifierFailing", { table: qualifier.table, runId: qualifier.runId });
  return qualifier.failingTests.length === 0
    ? [head]
    : [head, t("bi.qualifierFailingTests", { tests: qualifier.failingTests.join(", ") })];
}
