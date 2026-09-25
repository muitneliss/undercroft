/**
 * A tool's answer, as the rows and columns the grid widget prints. Pure: no DOM, no host.
 *
 * Seven procedures are drawn as a grid (`MCP_WIDGETS` in the control plane's `surface.ts`), and
 * they answer in three shapes: a query's `TableResult`, a page of search hits, a page of raw
 * records or documents. Each is read here by a function typed against what that procedure
 * ANSWERS (`ToolContentOf`), so a change to a procedure's output, or a procedure added to the
 * grid, fails this file's compile -- the router is the source of truth, and the widget is one
 * more caller the compiler holds to it.
 *
 * A cell reads exactly as it does in the web UI's `ResultTable` (`apps/ui/src/lib/cells.ts`):
 * a string -- which is how a `numeric` or `bigint` arrives -- is printed verbatim, every digit;
 * `null` is MISSING, never an empty cell or a zero; an integer is grouped the reader's way and
 * any other number is printed as it came. Nothing here parses a string into a number
 * (`.claude/rules/money.md`). The two are twins across a hard boundary -- one renders in the
 * SPA, this in a host's sandboxed frame -- and a change to one is a change to both.
 */

import type { ToolContentOf, WidgetPaths } from "@undercroft/control-plane/surface";
import type { Locale } from "@undercroft/core/locale";
import { MISSING } from "@undercroft/core/money";
import type { Words } from "./i18n.ts";

export type Cell = string | number | boolean | null;

export interface Column {
  readonly name: string;
  /** The Postgres type, for a query's columns; `null` where the answer is not a query's. */
  readonly type: string | null;
}

export interface Grid {
  readonly columns: readonly Column[];
  readonly rows: readonly (readonly Cell[])[];
  /** The server said more rows exist than it returned. */
  readonly more: boolean;
}

/**
 * The most rows the widget draws. A host's frame is a glance, not an export; the whole answer
 * is still in the tool's structured content, and the banner says how much was left out.
 */
export const MAX_ROWS = 500;

type GridPath = WidgetPaths<"grid">;

type Reader<P extends GridPath> = (content: ToolContentOf<P>, t: Words) => Grid;

function queryResult(content: ToolContentOf<"lake.query">): Grid {
  return { columns: content.columns, rows: content.rows, more: content.truncated };
}

function column(name: string): Column {
  return { name, type: null };
}

const READERS: { readonly [P in GridPath]: Reader<P> } = {
  "lake.query": queryResult,
  "bi.answer": queryResult,
  "bi.runQuestion": queryResult,
  "bi.questions.answer": queryResult,

  "lake.search": (content, t) => ({
    columns: [
      t("colKind"),
      t("colSource"),
      t("colRecord"),
      t("colExcerpt"),
      t("colObservedAt"),
      t("colDeletedAt"),
    ].map(column),
    rows: content.hits.map((hit) => [
      hit.kind,
      hit.source,
      // Two facts side by side, not a sentence, so they are joined as the lake's lines are.
      hit.kind === "record" ? `${hit.entity} · ${hit.sourceRecordId}` : hit.documentId,
      hit.excerpt,
      hit.observedAt,
      hit.deletedAt,
    ]),
    more: content.truncated,
  }),

  "lake.records": (content, t) => ({
    columns: [
      t("colSource"),
      t("colEntity"),
      t("colRecord"),
      t("colObservedAt"),
      t("colDeletedAt"),
      t("colPayload"),
    ].map(column),
    rows: content.items.map((record) => [
      record.source,
      record.entity,
      record.sourceRecordId,
      record.observedAt,
      record.deletedAt,
      record.payload,
    ]),
    more: content.nextCursor !== null,
  }),

  "lake.documents": (content, t) => ({
    columns: [
      t("colDocument"),
      t("colSource"),
      t("colContentType"),
      t("colBytes"),
      t("colObservedAt"),
      t("colDeletedAt"),
    ].map(column),
    rows: content.items.map((document) => [
      document.documentId,
      document.source,
      document.contentType,
      document.bytes,
      document.observedAt,
      document.deletedAt,
    ]),
    more: content.nextCursor !== null,
  }),
};

function isGridPath(path: string): path is GridPath {
  return Object.hasOwn(READERS, path);
}

function readerFor<P extends GridPath>(path: P): Reader<P> {
  return READERS[path];
}

/**
 * The grid for a result, or `null` when the procedure that answered is not one the grid draws.
 *
 * `content` is the tool's `structuredContent`, which the door produced from exactly the
 * procedure `path` names -- tRPC typed that output on the server, and the door only wraps
 * it (`ToolContentOf`). Checking its shape again here would be a second definition of the
 * procedure's output, drifting from the first; the assertion below says where the one lives.
 */
export function gridOf(path: string, content: unknown, t: Words): Grid | null {
  if (!isGridPath(path)) {
    return null;
  }
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the door built this from `path`'s own typed output; see above.
  return readerFor(path)(content as ToolContentOf<typeof path>, t);
}

/** The rows the widget draws, and how many there were. */
export function capped(grid: Grid): { rows: readonly (readonly Cell[])[]; total: number } {
  return { rows: grid.rows.slice(0, MAX_ROWS), total: grid.rows.length };
}

/** Which CLDR locale groups a count for each of our languages, as the web UI's `formatCount`. */
const CLDR: Readonly<Record<Locale, string>> = { vi: "vi-VN", en: "en-SG" };

/** One cell, as the web UI's `cellText` prints it. See the module note. */
export function cellText(cell: Cell, locale: Locale, t: Words): string {
  if (cell === null) {
    return MISSING;
  }
  if (typeof cell === "boolean") {
    return cell ? t("yes") : t("no");
  }
  if (typeof cell === "number") {
    return Number.isInteger(cell) ? cell.toLocaleString(CLDR[locale]) : String(cell);
  }
  return cell;
}
