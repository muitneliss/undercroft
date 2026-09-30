/**
 * A question's answer as the reader reads it and takes it: the drawing the question saved,
 * the rows that drew it, and those rows as a CSV file -- for every role that can run it.
 *
 * ADR 0020 keeps Reports on Chart.js's sixteen types and answers what a drawing cannot say
 * with a table. Until now that table was an author's control (switching the type), so a
 * viewer could read exact figures only off a tooltip. Here the rows are offered beneath
 * every drawing, in a fold rather than always open, because the drawing is what the author
 * chose to lead with. Pressing a point or a bar marks the row that drew it and opens the
 * fold; which point lives in the address, so nothing here holds state.
 *
 * The CSV is built in the browser from the very result on screen (`lib/csv.ts`), so it is
 * exactly those rows and columns, for the parameters in use, under the reader's own run. A
 * result cut at its row limit says so beside the control, before the file is taken, because
 * a file that silently stops at row 1,000 reads as the whole answer.
 */

import type { ChartConfig } from "@undercroft/contracts/bi";
import type { Locale } from "@undercroft/core/locale";
import { lazy, Suspense, useId } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { TableResult } from "@/api/types.ts";
import { ResultTable } from "@/components/ResultTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { POINT, pointFromSearch, rowsAt, withPoint } from "@/lib/chartData.ts";
import { resultCsvBlob } from "@/lib/csv.ts";

const ChartFrame = lazy(() =>
  import("@/components/charts/ChartFrame.tsx").then((module) => ({ default: module.ChartFrame })),
);

/** Characters a file system refuses in a name, replaced rather than dropped. */
const UNSAFE_FILENAME = /[\\/:*?"<>|]/gu;

function fileName(name: string, fallback: string): string {
  const cleaned = name.replace(UNSAFE_FILENAME, "_").trim();
  return `${cleaned === "" ? fallback : cleaned}.csv`;
}

/** Hand the reader the file. The object URL is released once the browser has taken it. */
function download(result: TableResult, name: string): void {
  const href = URL.createObjectURL(resultCsvBlob(result));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 0);
}

/** The download control, and -- before it is pressed -- whether the file is the whole answer. */
function CsvTake({ result, name }: { result: TableResult; name: string }): React.JSX.Element {
  const { t } = useTranslation();
  const noteId = useId();
  return (
    <div className="row">
      <button
        aria-describedby={result.truncated ? noteId : undefined}
        className="plate"
        disabled={result.columns.length === 0}
        type="button"
        onClick={(): void => {
          download(result, fileName(name, t("bi.csvFallbackName")));
        }}
      >
        {t("bi.csvDownload")}
      </button>
      <span className={result.truncated ? "note" : "datum datum--quiet"} id={noteId}>
        {result.truncated
          ? t("bi.csvTruncated", { count: result.rows.length })
          : t("bi.csvWhole", { count: result.rows.length })}
      </span>
    </div>
  );
}

/**
 * The rows that drew the chart, folded. The fold is keyed on the selected point, so pressing
 * a point re-opens it on the marked row even after the reader folded it away.
 */
function DrawnRows({
  result,
  locale,
  marked,
  pointKey,
}: {
  result: TableResult;
  locale: Locale;
  marked: ReadonlySet<number>;
  pointKey: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <details key={pointKey} className="tokenform" open={marked.size > 0}>
      <summary className="plate">{t("bi.rowsShow", { count: result.rows.length })}</summary>
      <div className="stack stack--tight">
        {marked.size > 0 ? (
          <p className="note" role="status">
            {t("bi.rowsMarked", { count: marked.size })}
          </p>
        ) : null}
        <ResultTable result={result} locale={locale} marked={marked} />
      </div>
    </details>
  );
}

export function ResultReading({
  result,
  chart,
  locale,
  name,
}: {
  result: TableResult;
  chart: ChartConfig;
  locale: Locale;
  /** The question's name, which names the file. */
  name: string;
}): React.JSX.Element {
  const [search, setSearch] = useSearchParams();
  const point = pointFromSearch(search);
  const marked = new Set(point === null ? [] : rowsAt(result, chart, point));

  return (
    <>
      <Suspense fallback={<Skeleton rows={4} />}>
        <ChartFrame
          result={result}
          chart={chart}
          locale={locale}
          onSelect={(selected): void => {
            setSearch((current) => withPoint(current, selected), { replace: true });
          }}
        />
      </Suspense>
      {/* A question drawn as a table already is its rows. */}
      {chart.type === "table" || result.rows.length === 0 ? null : (
        <DrawnRows
          result={result}
          locale={locale}
          marked={marked}
          pointKey={search.get(POINT) ?? ""}
        />
      )}
      <CsvTake result={result} name={name} />
    </>
  );
}
