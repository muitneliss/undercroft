/**
 * What a reader asks of one model before reading its SQL, as a row of facts under its name:
 * how its last build went, whether what is on screen is what the server holds, which run built
 * it, how many columns that made, and what the tests of the build serving its rows found
 * (ADR 0129) -- with the failing and warning tests named beneath. The shared fact row (`Facts`),
 * with values that are marks and links rather than only text.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { ModelDetail } from "@/api/types.ts";
import { Fact, Facts } from "@/components/Facts.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { buildMark, buildMarkLabel } from "@/lib/modelBuild.ts";
import { formatCount, MISSING } from "@/lib/money.ts";
import { journalPath } from "@/lib/runs.ts";
import { testsLabel, testsMark, warningsLabel } from "@/lib/testState.ts";

/**
 * A model never built says so as a state, and has no run and no known columns: those two are
 * MISSING, never a zero or an empty cell (`columnCount` on the server says why no columns recorded
 * is not "none").
 */
export function ModelFacts({
  tenantId,
  stored,
  dirty,
  locale,
}: {
  tenantId: string;
  stored: ModelDetail;
  dirty: boolean;
  locale: "vi" | "en";
}): React.JSX.Element {
  const { t } = useTranslation();
  const built = stored.lastBuild;
  const columns = built?.columnCount ?? null;
  const tests = stored.lastTests;
  const warned = warningsLabel(t, locale, tests);
  const names = (list: readonly { readonly name: string }[]): string =>
    list.map((test) => test.name).join(", ");
  return (
    <>
    <Facts>
      <Fact label={t("models.colBuild")}>
        <StatusMark
          mark={buildMark(built?.status ?? null)}
          label={buildMarkLabel(t, built?.status ?? null)}
        />
      </Fact>
      <Fact label={t("models.factSql")}>{dirty ? t("models.unsaved") : t("models.saved")}</Fact>
      <Fact label={t("models.colRun")}>
        {built === null ? (
          <span className="missing">{MISSING}</span>
        ) : (
          <Link to={journalPath(tenantId, { runId: built.runId })}>{built.runId}</Link>
        )}
      </Fact>
      <Fact label={t("models.factColumns")}>
        {columns === null ? (
          <span className="missing">{MISSING}</span>
        ) : (
          formatCount(columns, locale)
        )}
      </Fact>
      {/* Not the build's status: a build whose tests fail still succeeds and is served. */}
      <Fact label={t("models.colTests")}>
        <StatusMark mark={testsMark(tests.state)} label={testsLabel(t, locale, tests)} />
        {warned === null ? null : (
          <span className="datum datum--quiet journal__trigger">{warned}</span>
        )}
      </Fact>
    </Facts>
    {tests.failingTests.length === 0 || tests.runId === null ? null : (
      <p className="note">
        {t("models.failingTestsNote", { runId: tests.runId, tests: names(tests.failingTests) })}
      </p>
    )}
    {tests.warningTests.length === 0 || tests.runId === null ? null : (
      <p className="note">
        {t("models.warningTestsNote", { runId: tests.runId, tests: names(tests.warningTests) })}
      </p>
    )}
    </>
  );
}
