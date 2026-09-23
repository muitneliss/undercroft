/**
 * dbt's steps as a table: one row per model or test, with the failing-row count a test
 * reported and how long the node took. Drawn on a run's leaf in the journal and under a
 * build in the editor, so the two read the same.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
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
    <Table>
      <TableCaption>{t("journal.stepsHead")}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("journal.colStep")}</TableHead>
          <TableHead scope="col">{t("journal.colStatus")}</TableHead>
          <TableHead scope="col" className="num">
            {t("journal.colFailures")}
          </TableHead>
          <TableHead scope="col" className="num">
            {t("journal.colTook")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {steps.map((step) => (
          <TableRow key={step.uniqueId}>
            <TableCell className="datum">{stepName(step)}</TableCell>
            <TableCell>{step.status}</TableCell>
            <TableCell className="num">
              {step.failures === null ? MISSING : formatCount(step.failures, locale)}
            </TableCell>
            <TableCell className="num datum datum--quiet">
              {step.executionMs === null
                ? MISSING
                : formatDuration(
                    new Date(0).toISOString(),
                    new Date(step.executionMs).toISOString(),
                    locale,
                  )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
