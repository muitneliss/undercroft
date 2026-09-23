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
import { SizeGrip } from "@/components/SizeGrip.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { cellText } from "@/lib/cells.ts";

/**
 * How long a value has to be before it is worth a disclosure.
 *
 * A grid is read by scanning DOWN a column, and that only works while every row is the same
 * height. One extracted document's text is six thousand characters; left whole it made its
 * own row two hundred pixels tall, pushed every neighbouring column into four wrapped lines,
 * and cost the reader the one thing a table is for. Ninety characters is a long filename or
 * a sentence -- enough to recognise a value, short enough that a hundred rows stay scannable.
 */
const OPENABLE_CHARS = 90;

/**
 * How much of that value the clipped line carries into the DOM.
 *
 * NOT what the reader sees: the COLUMN decides that, by clipping the line to its own width,
 * and the column is theirs to drag wider. This figure only bounds what is shipped -- a
 * hundred rows of a six-thousand-character document text is half a megabyte of DOM for a
 * line nobody can read to the end of. Four hundred is past the widest a column gets on a
 * 27-inch display, so dragging reveals text rather than running out of it; the whole value
 * is one press away regardless. Slicing at `OPENABLE_CHARS` instead -- which is what this
 * did while the width was fixed -- made a dragged column reveal nothing past its 90th
 * character.
 */
const LINE_CHARS = 400;

/**
 * One cell: a line, clipped by its column, and openable when there is more.
 *
 * A native `<details>`, the same disclosure the raw browser already uses for a payload: it
 * needs no state (`state.md` bans `useState`, and which cell is open is not application
 * state anyway), it is reachable by keyboard, and it survives a re-render of the grid.
 * A value that fits is printed plainly -- a disclosure triangle on every short cell would be
 * ninety pieces of furniture for nothing.
 */
function Cell({ text }: { text: string }): React.JSX.Element {
  if (text.length <= OPENABLE_CHARS) {
    return <span className="cell">{text}</span>;
  }
  return (
    <details className="cell cell--long">
      {/* The clipping is on the SPAN, not on the summary: a summary that clipped itself cut
          off its own disclosure triangle, and a cell with no marker is one a reader never
          learns can be opened. */}
      <summary>
        <span className="cell__clip">{text.slice(0, LINE_CHARS)}</span>
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
      {/* `result--grid` is what separates a QUERY's answer from the pivot in `ChartFrame`,
          which is drawn into a bare `.result` and is a schedule: its last column is a total
          and means to be right-aligned, and its columns are figures that want to be as wide
          as the figure. Everything this grid does -- reading left, dividing its pane into
          equal columns, handing each of them to the reader to drag -- is wrong there. */}
      <div className="result result--grid">
        <Table>
          {fill ? null : (
            <TableCaption>{t("result.caption", { count: result.rows.length })}</TableCaption>
          )}
          <TableHeader>
            <TableRow>
              {result.columns.map((column) => (
                <TableHead key={column.name} scope="col">
                  {column.name}
                  <span className="datum datum--quiet result__type">{column.type}</span>
                  {/* The boundary with the next column, the full height of the cell. It is
                      written here rather than in `ui/table.tsx`, which is vendored and
                      re-fetched (ADR 0025) and does not know a grid from a schedule. */}
                  <SizeGrip axis="inline" label={t("grip.columnWidth", { name: column.name })} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex} className="datum">
                    <Cell text={cellText(t, cell, locale)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {result.truncated && !fill ? (
        <p className="note">{t("result.truncated", { count: result.rows.length })}</p>
      ) : null}
    </div>
  );
}
