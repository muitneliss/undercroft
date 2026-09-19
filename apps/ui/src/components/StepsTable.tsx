/**
 * dbt's steps as a table: one row per model or test, with the failing-row count a test
 * reported and how long the node took. Drawn on a run's leaf in the journal and under a
 * build in the editor, so the two read the same.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import { formatCount, MISSING } from "@/lib/money.ts";
import { formatDuration } from "@/lib/when.ts";

export interface Step {
  readonly uniqueId: string;
  readonly kind: string;
  readonly name: string;
  readonly status: string;
  readonly failures: number | null;
  readonly executionMs: number | null;
}

/** `model: stg_deals`, `test: not_null_stg_deals_id` -- dbt's own words for its own nodes. */
function stepName(step: { kind: string; name: string }): string {
  return `${step.kind}: ${step.name}`;
}

export function StepsTable({
  steps,
  locale,
}: {
  steps: readonly Step[];
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <table className="table">
      <caption>{t("journal.stepsHead")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("journal.colStep")}</th>
          <th scope="col">{t("journal.colStatus")}</th>
          <th scope="col" className="num">
            {t("journal.colFailures")}
          </th>
          <th scope="col" className="num">
            {t("journal.colTook")}
          </th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.uniqueId}>
            <td className="datum">{stepName(step)}</td>
            <td>{step.status}</td>
            <td className="num">
              {step.failures === null ? MISSING : formatCount(step.failures, locale)}
            </td>
            <td className="num datum datum--quiet">
              {step.executionMs === null
                ? MISSING
                : formatDuration(
                    new Date(0).toISOString(),
                    new Date(step.executionMs).toISOString(),
                    locale,
                  )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
