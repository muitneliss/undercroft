/**
 * Demo Co.'s reports, as the visual tier reads them: the Reports division of the design review's
 * own synthetic book (`CASE-0042`), answered the way the server answers.
 *
 * Mirrors the design's fixtures: five saved questions and three dashboards, the first --
 * "Business performance" -- with its two questions over `revenue_monthly` under a month range.
 * Every name and figure is invented (`.claude/rules/pii.md`); amounts are strings, as they are
 * on the wire (`.claude/rules/money.md`).
 *
 * Only for `*.vrt.test.tsx` (ADR 0099). Fixture times sit a little before `VISUAL_NOW`.
 */

import { compile, QuestionDefinition } from "@undercroft/contracts/bi";

import type { DashboardView, QuestionView, SchemaView, TableResult } from "@/api/types.ts";
import { AUTHOR, idOf, type Role, reader } from "@/test/modelsBook.ts";
import type { Answers } from "@/test/visual.tsx";

const WHEN_SAVED = "2026-09-28T08:00:00Z";
const PERIOD_FROM = "{{period_from}}";
const PERIOD_TO = "{{period_to}}";

/** The two questions of "Business performance" read months within the dashboard's range. */
const IN_RANGE = [
  { column: "period", op: "gte" as const, value: PERIOD_FROM },
  { column: "period", op: "lte" as const, value: PERIOD_TO },
];

export const QUESTION_ID = {
  revenue: "00000000-0000-4000-8000-0000000000a1",
  segment: "00000000-0000-4000-8000-0000000000a2",
  aging: "00000000-0000-4000-8000-0000000000a3",
  ledger: "00000000-0000-4000-8000-0000000000a4",
  refunds: "00000000-0000-4000-8000-0000000000a5",
} as const;

export const DASHBOARD_ID = {
  performance: "00000000-0000-4000-8000-0000000000d1",
  receivables: "00000000-0000-4000-8000-0000000000d2",
  support: "00000000-0000-4000-8000-0000000000d3",
} as const;

type Definition = QuestionView["definition"];

function visual(
  table: string,
  fields: readonly string[],
  over: Partial<Extract<Definition, { kind: "visual" }>> = {},
): Definition {
  return {
    kind: "visual",
    table,
    fields: fields.map((column) => ({ column })),
    filters: [],
    groupBy: [],
    orderBy: [],
    limit: 1000,
    ...over,
  };
}

export const QUESTIONS: readonly QuestionView[] = [
  {
    id: QUESTION_ID.revenue,
    name: "Monthly revenue",
    definition: visual("revenue_monthly", ["period", "revenue"], {
      filters: IN_RANGE,
      orderBy: [{ by: "period", dir: "asc" }],
    }),
    chart: { type: "line", x: "period", y: ["revenue"], options: {} },
    updatedAt: WHEN_SAVED,
    updatedBy: AUTHOR,
  },
  {
    id: QUESTION_ID.segment,
    name: "Revenue by segment",
    definition: {
      kind: "visual",
      table: "revenue_monthly",
      fields: [{ column: "segment" }, { column: "revenue", aggregate: "sum", alias: "revenue" }],
      filters: IN_RANGE,
      groupBy: ["segment"],
      orderBy: [{ by: "revenue", dir: "desc" }],
      limit: 1000,
    },
    chart: { type: "bar", x: "segment", y: ["revenue"], options: {} },
    updatedAt: WHEN_SAVED,
    updatedBy: AUTHOR,
  },
  {
    id: QUESTION_ID.aging,
    name: "Receivables by age",
    definition: visual("ar_open_items", ["age", "amount"]),
    chart: { type: "bar", x: "age", y: ["amount"], options: {} },
    updatedAt: "2026-09-27T08:00:00Z",
    updatedBy: AUTHOR,
  },
  {
    id: QUESTION_ID.ledger,
    name: "Open invoice ledger",
    definition: {
      kind: "sql",
      sql: "select id, customer, due, amount, currency\nfrom ar_open_items\norder by due",
    },
    chart: { type: "table", y: [], options: {} },
    updatedAt: "2026-09-27T08:00:00Z",
    updatedBy: AUTHOR,
  },
  {
    id: QUESTION_ID.refunds,
    name: "Refund reasons",
    definition: visual("refund_reasons", ["reason", "refunds"]),
    chart: { type: "bar", x: "reason", y: ["refunds"], options: {} },
    updatedAt: "2026-09-29T08:00:00Z",
    updatedBy: AUTHOR,
  },
];

/** The dashboard's range, in the address, so every tile has its values and draws at once. */
export const PERFORMANCE_RANGE = "p.period_from=2026-04-01&p.period_to=2026-09-30";

export const DASHBOARDS: readonly DashboardView[] = [
  {
    id: DASHBOARD_ID.performance,
    name: "Business performance",
    layout: {
      tiles: [
        { questionId: QUESTION_ID.revenue, x: 0, y: 0, w: 6, h: 4 },
        { questionId: QUESTION_ID.segment, x: 6, y: 0, w: 6, h: 4 },
      ],
    },
    filters: [{ name: "period", kind: "date_range", label: "Month range" }],
    updatedAt: WHEN_SAVED,
    updatedBy: AUTHOR,
  },
  {
    id: DASHBOARD_ID.receivables,
    name: "Accounts receivable",
    layout: {
      tiles: [
        { questionId: QUESTION_ID.aging, x: 0, y: 0, w: 6, h: 4 },
        { questionId: QUESTION_ID.ledger, x: 6, y: 0, w: 6, h: 4 },
      ],
    },
    filters: [],
    updatedAt: "2026-09-27T08:00:00Z",
    updatedBy: AUTHOR,
  },
  {
    id: DASHBOARD_ID.support,
    name: "Service quality",
    layout: { tiles: [{ questionId: QUESTION_ID.refunds, x: 0, y: 0, w: 12, h: 4 }] },
    filters: [],
    updatedAt: "2026-09-29T08:00:00Z",
    updatedBy: AUTHOR,
  },
];

/** Each month by its first day, as `revenue_monthly` keys it. */
const MONTHS = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];
/** The design's revenue, services plus products per month, in SGD. */
const MONTHLY = ["94500.25", "100000.25", "103000.75", "110000.00", "118200.50", "128600.50"];

const ANSWERS: Readonly<Record<string, TableResult>> = {
  [QUESTION_ID.revenue]: {
    columns: [
      { name: "period", type: "date" },
      { name: "revenue", type: "numeric" },
    ],
    rows: MONTHS.map((month, index) => [month, MONTHLY[index] ?? null]),
    truncated: false,
  },
  [QUESTION_ID.segment]: {
    columns: [
      { name: "segment", type: "text" },
      { name: "revenue", type: "numeric" },
    ],
    rows: [
      ["services", "399501.75"],
      ["products", "254800.50"],
    ],
    truncated: false,
  },
};

/** The analytics schema the builder offers: the tables the questions read. */
const SCHEMA: SchemaView = {
  tables: [
    {
      name: "ar_open_items",
      columns: [
        { name: "id", type: "text" },
        { name: "customer", type: "text" },
        { name: "due", type: "date" },
        { name: "age", type: "text" },
        { name: "amount", type: "numeric" },
        { name: "currency", type: "text" },
      ],
    },
    {
      name: "revenue_monthly",
      columns: [
        { name: "period", type: "date" },
        { name: "segment", type: "text" },
        { name: "revenue", type: "numeric" },
        { name: "currency", type: "text" },
      ],
    },
  ],
};

/** The definition the page sent, read as the server reads it; `undefined` if it is not one. */
function definitionOf(input: unknown): QuestionDefinition | undefined {
  if (typeof input === "object" && input !== null && "definition" in input) {
    const read = QuestionDefinition.safeParse(input.definition);
    return read.success ? read.data : undefined;
  }
  return undefined;
}

/** Everything the Reports division asks, read by `role`. */
export function reportsAnswers(role: Role): Answers {
  return {
    "tenants.get": reader(role),
    "bi.questions.list": QUESTIONS,
    "bi.dashboards.list": DASHBOARDS,
    "bi.questions.get": (input: unknown) => QUESTIONS.find((q) => q.id === idOf(input)),
    "bi.dashboards.get": (input: unknown) => DASHBOARDS.find((d) => d.id === idOf(input)),
    "bi.questions.answer": (input: unknown) => ANSWERS[idOf(input) ?? ""],
    "bi.schema": SCHEMA,
    // The server's own compiler, as `bi.compile` runs it; members only, so a viewer never asks.
    "bi.compile": (input: unknown): { sql: string } | undefined => {
      const definition = definitionOf(input);
      return definition === undefined ? undefined : { sql: compile(definition) };
    },
  };
}
