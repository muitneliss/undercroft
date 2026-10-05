/**
 * Demo Co.'s models, as the visual tier reads them: the Models division of the design review's
 * own synthetic book (`CASE-0042`), answered the way the server answers -- and the reader of
 * that book, by role, which `reportsBook.ts` shares.
 *
 * Mirrors the design's fixtures rather than inventing new ones, so a capture can be read beside
 * the design's picture of the same screen: its fourteen models with their last builds, and what
 * each declares it reads (one ref to a model since deleted, one ref no reader can follow). Three
 * models carry an approved business context (ADR 0105): two still current, and churn_watch's
 * out of date since a model it reads changed -- the state the editor's picture shows.
 * Nothing here is anonymised from real data; every name is invented (`.claude/rules/pii.md`).
 *
 * Only for `*.vrt.test.tsx` (ADR 0099). Fixture times sit a little before `VISUAL_NOW`.
 */

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@undercroft/control-plane/router";

import type { ModelDetail, ModelItem, ModelLineage } from "@/api/types.ts";
import type { Answers } from "@/test/visual.tsx";

type Outputs = inferRouterOutputs<AppRouter>;
export type Role = Outputs["tenants"]["get"]["role"];

export const TENANT = "CASE-0042";
const DISPLAY_NAME = "Demo Co.";
/** Who saved everything here: the signed-in reader the harness answers `session.me` with. */
export const AUTHOR = "user-1";

/** What each model's SQL declares, as the design's `modelFixtures` records it. */
interface Declares {
  readonly refs?: readonly string[];
  readonly source?: "records" | "documents";
  readonly entity?: string;
  /** The ref's target is a variable: its upstream cannot be read from its declarations. */
  readonly dynamic?: true;
}

/** The design's fourteen models, its build states, in its order. `null` is never built. */
const MODELS: readonly (readonly [string, "error" | "skipped" | "success" | null, Declares])[] = [
  ["customer_health_daily", "error", { refs: ["dim_customer", "ar_open_items"] }],
  ["orders_daily", "success", { refs: ["stg_orders"] }],
  ["revenue_monthly", "success", { refs: ["orders_daily", "payment_summary"] }],
  ["refund_reasons", null, { refs: ["stg_document_text"] }],
  ["stg_customers", "success", { source: "records", entity: "contacts" }],
  ["stg_orders", "success", { source: "records", entity: "deals" }],
  ["stg_xero_invoices", "success", { source: "records", entity: "invoices" }],
  ["stg_document_text", "skipped", { source: "documents", entity: "documents" }],
  ["dim_customer", "success", { refs: ["stg_customers"] }],
  ["ar_open_items", "success", { refs: ["stg_xero_invoices"] }],
  ["stg_payments", "success", { source: "records", entity: "payments" }],
  ["payment_summary", "success", { refs: ["stg_payments"] }],
  ["legacy_rollup", "success", { dynamic: true }],
  // Refs a model that was deleted: the ref stays, and lineage shows it as missing.
  ["churn_watch", "error", { refs: ["dim_customer", "stg_churn_signals"] }],
];

/** The SQL a model was saved with, written to declare exactly what `Declares` says. */
function sqlOf(declares: Declares): string {
  const head = "-- Synthetic review fixture.\n";
  if (declares.dynamic === true) {
    return `${head}select *\nfrom {{ ref(var('rollup_target')) }}\n`;
  }
  if (declares.source !== undefined) {
    return `${head}select *\nfrom {{ source('undercroft', '${declares.source}') }}\nwhere entity = '${declares.entity ?? ""}'\n`;
  }
  const [first, ...rest] = declares.refs ?? [];
  const joins = rest.map((ref) => `join {{ ref('${ref}') }} using (id)\n`).join("");
  return `${head}select *\nfrom {{ ref('${first ?? ""}') }}\n${joins}`;
}

type ModelContext = ModelDetail["context"];
type ContextBody = NonNullable<ModelContext["body"]>;

/** The approved contexts, by model; every other model has none and reads `incomplete`. */
const CONTEXTS: Readonly<Record<string, { body: ContextBody; changes: ModelContext["changes"] }>> =
  {
    churn_watch: {
      body: {
        purpose: "Customers whose ordering has slowed, for the account team's weekly call.",
        grain: "One customer.",
        key: { kind: "declared", columns: ["customer_id"] },
        columns: [
          { name: "customer_id", definition: "The customer's id in the CRM." },
          {
            name: "days_since_order",
            definition: "Days since the customer's last order.",
            unit: "days",
          },
        ],
        rules: { kind: "listed", items: ["A customer with no order in 90 days is on the list."] },
      },
      changes: [{ model: "dim_customer", kind: "sql" }],
    },
    orders_daily: {
      body: {
        purpose: "Orders per day, for the revenue report.",
        grain: "One calendar day.",
        key: { kind: "declared", columns: ["order_date"] },
        columns: [{ name: "order_date", definition: "The day, in Asia/Singapore." }],
        rules: { kind: "none" },
      },
      changes: [],
    },
    stg_orders: {
      body: {
        purpose: "The CRM's deals, one row per deal, as the source sent them.",
        grain: "One deal.",
        key: { kind: "declared", columns: ["deal_id"] },
        columns: [{ name: "deal_id", definition: "The deal's id in the CRM." }],
        rules: { kind: "none" },
      },
      changes: [],
    },
  };

const ALL_SECTIONS = ["purpose", "grain", "key", "columns", "rules"] as const;
const REVIEWED_AT = "2026-09-20T08:00:00Z";

function contextSummary(name: string): ModelItem["context"] {
  const approved = CONTEXTS[name];
  if (approved === undefined) {
    return { state: "incomplete", missing: [...ALL_SECTIONS], changes: [] };
  }
  const { changes } = approved;
  return { state: changes.length > 0 ? "needs_review" : "current", missing: [], changes };
}

/** The context as `models.get` answers it, its findings worked out as the server would. */
function contextOf(name: string, built: readonly string[] | null, dynamic: boolean): ModelContext {
  const approved = CONTEXTS[name];
  const body = approved?.body ?? null;
  const named = body === null ? [] : body.columns.map((column) => column.name);
  return {
    ...contextSummary(name),
    body,
    reviewedBy: body === null ? null : AUTHOR,
    reviewedAt: body === null ? null : REVIEWED_AT,
    basis: `basis-${name}`,
    absentColumns: built === null ? null : named.filter((column) => !built.includes(column)),
    upstreamUndeclared: dynamic,
  };
}

function columnNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `column_${String(index + 1)}`);
}

const FIRST_COLUMNS = 12;
const FIRST_RUN = 42;
const LAST_UPDATED_DAY = 28;
const UPDATE_SPREAD = 3;
const LAST_BUILD_MINUTE = 50;

export const MODEL_LIST: readonly ModelItem[] = MODELS.map(([name, status], index) => ({
  name,
  updatedAt: `2026-09-${String(LAST_UPDATED_DAY - (index % UPDATE_SPREAD))}T08:00:00Z`,
  updatedBy: AUTHOR,
  context: contextSummary(name),
  lastBuild:
    status === null
      ? null
      : {
          runId: `run-mg4k${String(FIRST_RUN + index).padStart(4, "0")}-5e1f0a42`,
          status,
          endedAt: `2026-09-29T08:${String(LAST_BUILD_MINUTE - index).padStart(2, "0")}:00Z`,
          columns: columnNames(FIRST_COLUMNS + index),
        },
}));

function modelDetail(name: string): ModelDetail | undefined {
  const item = MODEL_LIST.find((model) => model.name === name);
  const declares = MODELS.find(([model]) => model === name)?.[2];
  if (item === undefined || declares === undefined) {
    return undefined;
  }
  return {
    ...item,
    sql: sqlOf(declares),
    tests: { columns: { id: ["not_null"] } },
    context: contextOf(name, item.lastBuild?.columns ?? null, declares.dynamic === true),
  };
}

const RAW = { records: "raw:raw.records", documents: "raw:raw.documents" } as const;

/** What the models declare, as `models.lineage` answers it (ADR 0092): nothing inferred. */
export const LINEAGE: ModelLineage = {
  nodes: [
    { kind: "raw", id: RAW.records, name: "raw.records" },
    { kind: "raw", id: RAW.documents, name: "raw.documents" },
    ...MODELS.map(([name, , declares]) => ({
      kind: "model" as const,
      id: `model:${name}`,
      name,
      undeclared:
        declares.dynamic === true
          ? [{ code: "dynamic-reference" as const, subject: "ref", via: null }]
          : [],
    })),
    { kind: "missing", id: "missing:stg_churn_signals", name: "stg_churn_signals" },
  ],
  edges: MODELS.flatMap(([name, , declares]) => {
    const to = `model:${name}`;
    if (declares.source !== undefined) {
      return [{ from: RAW[declares.source], to, via: null }];
    }
    return (declares.refs ?? []).map((ref) => ({
      from: MODELS.some(([model]) => model === ref) ? `model:${ref}` : `missing:${ref}`,
      to,
      via: null,
    }));
  }),
};

/** The reader, by role, on Demo Co.'s book. */
export function reader(role: Role): Outputs["tenants"]["get"] {
  return { id: TENANT, displayName: DISPLAY_NAME, role, deactivatedAt: null };
}

function nameOf(input: unknown): string | undefined {
  if (typeof input === "object" && input !== null && "name" in input) {
    return typeof input.name === "string" ? input.name : undefined;
  }
  return undefined;
}

/** The `id` a query was asked about, for a fixture that answers per input. */
export function idOf(input: unknown): string | undefined {
  if (typeof input === "object" && input !== null && "id" in input) {
    return typeof input.id === "string" ? input.id : undefined;
  }
  return undefined;
}

/** Everything the Models division asks, read by `role`. */
export function modelsAnswers(role: Role): Answers {
  return {
    "tenants.get": reader(role),
    "models.list": MODEL_LIST,
    "models.lineage": LINEAGE,
    "models.get": (input: unknown) => modelDetail(nameOf(input) ?? ""),
    "models.reference": { sourcesYml: "version: 2\n", macros: [], tenantMacros: [] },
  };
}
