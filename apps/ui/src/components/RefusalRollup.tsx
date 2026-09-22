/**
 * What a run refused, grouped by reason -- the band that answers "245 of what?".
 *
 * THE DEFECT THIS EXISTS TO FIX. The run's flow rail printed `255 bản ghi · 245 bị từ chối`
 * and the table under it was gated on there being per-record rows, which the extract verb
 * never wrote. So the count appeared in the one place that could not explain it while the
 * explanation sat in `raw.document_text` where no screen looked, and the only way to learn
 * what the 245 were was an SSH session and seven psql queries. ADR 0039.
 *
 * A COUNT ALWAYS HAS A ROUTE TO ITS CONSTITUENTS. That is this band's whole rule, and it is
 * the Absence Rule one level up: an em dash rather than a zero, and never a figure that leads
 * nowhere. Pressing a reason unfolds the documents it covers, in the row the reason is on, the
 * way the journal already unfolds a run inside its own row -- never a modal, so the reasons
 * above and below stay on screen and in the tab order while a reader compares them.
 *
 * SEVERITY IS THE HEADLINE, NOT THE COUNT. 230 signature images under the OCR size gate and
 * one missing `pdftotext` are both "refused", and rendering them alike is what made a healthy
 * run look like a fault. `refusalReasons.ts` decides which is which; this draws it with the
 * same four-geometry mark the rest of the book uses, so it survives greyscale.
 *
 * WHAT IT DOES NOT SHOW: a filename, ever. `pii.md` keeps names a human wrote out of Postgres
 * entirely, so the id in the unfolded list is the provider's own opaque document id -- the
 * same string the Lake division shows -- and there is nothing here to widen later.
 */

import { useTranslation } from "react-i18next";

import type { RunDetail } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { formatCount, orMissing } from "@/lib/money.ts";
import { presentReason } from "@/lib/refusalReasons.ts";
import { useUiStore } from "@/store.ts";

/** The rollup's columns, which an unfolded reason's row spans. */
const COLUMNS = 3;

type ReasonCount = RunDetail["reasonCounts"][number];
type Refusal = RunDetail["refusals"][number];

export function RefusalRollup({
  runId,
  reasonCounts,
  refusals,
  pruned,
  retainedDays,
}: {
  runId: string;
  reasonCounts: readonly ReasonCount[];
  refusals: readonly Refusal[];
  /** The rollup remembers refusals whose per-record rows have aged out. */
  pruned: boolean;
  retainedDays: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const openReason = useUiStore((state) => state.openReason[runId]);
  const toggleReason = useUiStore((state) => state.toggleReason);

  return (
    <div className="stack stack--tight">
      <table className="table">
        <caption>{t("journal.rollupHead")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("journal.colReason")}</th>
            <th scope="col" className="num">
              {t("journal.colCount")}
            </th>
            <th scope="col">{t("journal.colStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {reasonCounts.map((row) => (
            <ReasonRow
              key={`${row.entity}/${row.reason}`}
              row={row}
              runId={runId}
              locale={locale}
              open={openReason === row.reason}
              // Only the reasons whose records survive can be unfolded. A reason with none is
              // a row that does not pretend to be a control -- a press that opened an empty
              // list would be the original defect again, one fold deeper.
              records={refusals.filter((refusal) => refusal.reason === row.reason)}
              onToggle={(): void => {
                toggleReason(runId, row.reason);
              }}
            />
          ))}
        </tbody>
      </table>

      {/* Said once under the table rather than on every row: it is a fact about the run's age,
          not about any one reason. Without it a month-old run reads as a count with nothing
          behind it, which is indistinguishable from the bug this band was built to close. */}
      {pruned ? (
        <p className="note">{t("journal.refusalsPrunedNote", { days: retainedDays })}</p>
      ) : null}
    </div>
  );
}

function ReasonRow({
  row,
  runId,
  locale,
  open,
  records,
  onToggle,
}: {
  row: ReasonCount;
  runId: string;
  locale: ReturnType<typeof useUiStore.getState>["locale"];
  open: boolean;
  records: readonly Refusal[];
  onToggle: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const reason = presentReason(t, row.reason);
  const panelId = `reason-${runId}-${row.reason.replaceAll(/[^\w-]/gu, "_")}`;
  const canOpen = records.length > 0;

  return (
    <>
      <tr>
        <td>
          <span className="stack stack--tight">
            {canOpen ? (
              <button
                className="plate plate--small"
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={onToggle}
              >
                {reason.title}
              </button>
            ) : (
              <span>{reason.title}</span>
            )}
            {/* The sentence a reader acts on, in Garamond, and the raw code in mono beside
                it: one is for understanding the page, the other for quoting it to somebody
                who will grep for it. */}
            <span className="prose">{reason.note}</span>
            <span className="datum datum--quiet">{reason.code}</span>
          </span>
        </td>
        <td className="num">{formatCount(row.count, locale)}</td>
        <td>
          <StatusMark
            mark={reason.severity === "act" ? "lapsed" : "granted"}
            label={reason.severity === "act" ? t("journal.reasonActs") : t("journal.reasonBenign")}
          />
        </td>
      </tr>
      {open ? (
        <tr className="table__hinge">
          <td colSpan={COLUMNS}>
            <div className="hinge" id={panelId}>
              <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
              <span className="hinge__punch hinge__punch--b" aria-hidden="true" />
              <table className="table">
                <caption>{t("journal.reasonRecords")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("journal.colRecordId")}</th>
                    <th scope="col">{t("journal.colEntity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((refusal) => (
                    <tr key={`${refusal.sourceRecordId}/${refusal.at}`}>
                      <td className="datum datum--quiet">{orMissing(refusal.sourceRecordId)}</td>
                      <td className="datum">{refusal.entity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
