/**
 * The grid widget: a tool's answer printed as a table, beside the answer in a host's chat.
 *
 * Draws the seven procedures `MCP_WIDGETS` maps to `grid`. What each cell says is `table.ts`,
 * the web UI's `ResultTable` rules cell for cell; this file is only the page: at most
 * `MAX_ROWS` rows, a banner saying how many were left out, a note when the server itself had
 * more, and a disclosure for a value too long to scan down a column.
 */

import type { Locale } from "@undercroft/core/locale";
import { element, type Host, mount, refusalMessage, type ToolResult } from "./host.ts";
import type { Words } from "./i18n.ts";
import { type Cell, capped, cellText, type Grid, gridOf, MAX_ROWS } from "./table.ts";

/** Past this a value is a disclosure, as in the web UI: a grid is read down its columns. */
const OPENABLE_CHARS = 90;
/** How much of a long value its closed line carries, as in the web UI. */
const LINE_CHARS = 400;

function cellNode(cell: Cell, locale: Locale, t: Words): Node {
  const text = cellText(cell, locale, t);
  if (text.length <= OPENABLE_CHARS) {
    return document.createTextNode(text);
  }
  return element(
    "details",
    null,
    element("summary", null, text.slice(0, LINE_CHARS)),
    element("pre", null, text),
  );
}

function table(grid: Grid, rows: readonly (readonly Cell[])[], locale: Locale, t: Words): Node {
  const head = element(
    "tr",
    null,
    ...grid.columns.map((column) =>
      element(
        "th",
        null,
        column.name,
        ...(column.type === null ? [] : [element("span", "type", column.type)]),
      ),
    ),
  );
  const body = rows.map((row) =>
    element("tr", null, ...row.map((cell) => element("td", null, cellNode(cell, locale, t)))),
  );
  return element(
    "div",
    "grid",
    element("table", null, element("thead", null, head), element("tbody", null, ...body)),
  );
}

function draw(result: ToolResult, host: Host): void {
  const t = host.t();
  const locale = host.locale();
  if (result.isError === true) {
    host.root.replaceChildren(
      element("p", "note note--error", t("refused", { message: refusalMessage(result) })),
    );
    return;
  }
  const path = host.callOf(result)?.path ?? "";
  const grid = gridOf(path, result.structuredContent, t);
  if (grid === null || grid.rows.length === 0) {
    host.root.replaceChildren(element("p", "note", t("empty")));
    return;
  }
  const { rows, total } = capped(grid);
  host.root.replaceChildren(
    ...(total > MAX_ROWS
      ? [
          element(
            "p",
            "note",
            t("shown", {
              shown: cellText(rows.length, locale, t),
              total: cellText(total, locale, t),
            }),
          ),
        ]
      : []),
    ...(grid.more ? [element("p", "note", t("more"))] : []),
    table(grid, rows, locale, t),
  );
}

await mount("Undercroft grid", draw);
