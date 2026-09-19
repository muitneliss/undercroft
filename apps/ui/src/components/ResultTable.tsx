/**
 * A query result, printed: the one table every tenant-scoped read is drawn with -- a
 * model's preview after a build, the rows a failed test stored, a question's answer.
 *
 * Column headers carry the Postgres type in the quiet face, because "amount numeric" and
 * "amount text" are different facts about a model and the author is the one who can fix
 * the second. Cells go through `cellText`: a numeric string prints every digit, null is
 * visibly missing.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import type { TableResult } from "@/api/types.ts";
import { cellText } from "@/lib/cells.ts";

export function ResultTable({
  result,
  locale,
}: {
  result: TableResult;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();

  if (result.rows.length === 0) {
    return <p className="note">{t("result.empty")}</p>;
  }

  return (
    <div className="stack stack--tight">
      <div className="result">
        <table className="table">
          <caption>{t("result.caption", { count: result.rows.length })}</caption>
          <thead>
            <tr>
              {result.columns.map((column) => (
                <th key={column.name} scope="col">
                  {column.name}
                  <span className="datum datum--quiet result__type">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="datum">
                    {cellText(t, cell, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.truncated ? (
        <p className="note">{t("result.truncated", { count: result.rows.length })}</p>
      ) : null}
    </div>
  );
}
