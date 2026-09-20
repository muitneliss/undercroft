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

/**
 * How much of a value a row shows before it has to be opened.
 *
 * A grid is read by scanning DOWN a column, and that only works while every row is the same
 * height. One extracted document's text is six thousand characters; left whole it made its
 * own row two hundred pixels tall, pushed every neighbouring column into four wrapped lines,
 * and cost the reader the one thing a table is for. Ninety characters is a long filename or
 * a sentence -- enough to recognise a value, short enough that a hundred rows stay scannable.
 */
const CLIP_CHARS = 90;

/**
 * One cell: clipped to a line, and openable when there is more.
 *
 * A native `<details>`, the same disclosure the raw browser already uses for a payload: it
 * needs no state (`state.md` bans `useState`, and which cell is open is not application
 * state anyway), it is reachable by keyboard, and it survives a re-render of the grid.
 * A value that fits is printed plainly -- a disclosure triangle on every short cell would be
 * ninety pieces of furniture for nothing.
 */
function Cell({ text }: { text: string }): React.JSX.Element {
  if (text.length <= CLIP_CHARS) {
    return <span className="cell">{text}</span>;
  }
  return (
    <details className="cell cell--long">
      {/* The clipping is on the SPAN, not on the summary: a summary that clipped itself cut
          off its own disclosure triangle, and a cell with no marker is one a reader never
          learns can be opened. */}
      <summary>
        <span className="cell__clip">{text.slice(0, CLIP_CHARS)}</span>
      </summary>
      {/* The value verbatim, wrapped, never re-parsed -- the same treatment a raw payload
          gets one band above. */}
      <pre className="cell__full">{text}</pre>
    </details>
  );
}

export function ResultTable({
  result,
  locale,
  fill = false,
}: {
  result: TableResult;
  locale: Locale;
  /**
   * Take the whole of the pane, and let the frame do the talking.
   *
   * A result printed INSIDE a page is one band among several, so it says how many rows it
   * has and whether it was cut short -- nothing else on the leaf would. A result that IS the
   * pane sits under a bar that already carries both facts and above a footer that pages it,
   * so repeating them turns two facts into four and the reader has to check they agree.
   * The flag therefore does one thing said two ways: fill the height, and drop the sentences
   * the frame has taken over.
   */
  fill?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  if (result.rows.length === 0) {
    return <p className="note">{t("result.empty")}</p>;
  }

  return (
    <div className={fill ? "result-pane" : "stack stack--tight"}>
      <div className="result">
        <table className="table">
          {fill ? null : <caption>{t("result.caption", { count: result.rows.length })}</caption>}
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
                    <Cell text={cellText(t, cell, locale)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.truncated && !fill ? (
        <p className="note">{t("result.truncated", { count: result.rows.length })}</p>
      ) : null}
    </div>
  );
}
