import type { Catalog, Layer, ModelRecord, Words } from "@/features/models-workspace/types.ts";

function words(vi: string, en: string): Words {
  return { vi, en };
}
const anchors = [
  {
    id: "stg_invoices",
    title: words("Hóa đơn", "Invoices"),
    layer: "input",
    domain: "receivables",
    description: words(
      "Chuẩn hóa hóa đơn từ hệ thống kế toán.",
      "Standardise invoices from the accounting system.",
    ),
    grain: words("Một hóa đơn.", "One invoice."),
    sources: ["xero"],
  },
  {
    id: "stg_payments",
    title: words("Thanh toán", "Payments"),
    layer: "input",
    domain: "receivables",
    description: words(
      "Chuẩn hóa từng khoản thanh toán đã ghi nhận.",
      "Standardise each recorded payment.",
    ),
    grain: words("Một khoản thanh toán.", "One payment."),
    sources: ["xero"],
  },
  {
    id: "stg_deals",
    title: words("Cơ hội bán hàng", "Sales opportunities"),
    layer: "input",
    domain: "sales",
    description: words("Cơ hội bán hàng từ CRM.", "Sales opportunities from the CRM."),
    grain: words("Một cơ hội bán hàng.", "One sales opportunity."),
    sources: ["hubspot"],
  },
  {
    id: "int_invoice_balance",
    title: words("Đối chiếu công nợ", "Reconcile receivables"),
    layer: "transform",
    domain: "receivables",
    description: words(
      "Ghép hóa đơn và thanh toán để tính số tiền còn phải thu.",
      "Match invoices and payments to calculate outstanding balances.",
    ),
    grain: words("Một hóa đơn, theo đồng tiền gốc.", "One invoice, in its original currency."),
    sources: ["xero"],
  },
  {
    id: "int_customer_identity",
    title: words("Hợp nhất khách hàng", "Unify customers"),
    layer: "transform",
    domain: "customers",
    description: words(
      "Ghép các mã khách hàng đã được khai báo tương ứng.",
      "Join customer identifiers with declared mappings.",
    ),
    grain: words("Một khách hàng đã đối chiếu.", "One matched customer."),
    sources: ["xero", "hubspot"],
  },
  {
    id: "mart_receivables",
    title: words("Công nợ khách hàng", "Customer receivables"),
    layer: "output",
    domain: "receivables",
    description: words(
      "Tổng hợp số dư phải thu theo khách hàng.",
      "Summarise receivable balances by customer.",
    ),
    grain: words("Một khách hàng và một đồng tiền.", "One customer and one currency."),
    sources: ["xero"],
  },
  {
    id: "mart_daily_revenue",
    title: words("Doanh thu theo ngày", "Daily revenue"),
    layer: "output",
    domain: "sales",
    description: words(
      "Doanh thu theo ngày và đồng tiền; chưa quy đổi tỷ giá.",
      "Revenue by day and currency; no currency conversion.",
    ),
    grain: words("Một ngày và một đồng tiền.", "One day and one currency."),
    sources: ["xero"],
  },
] satisfies {
  id: string;
  title: Words;
  layer: Layer;
  domain: string;
  description: Words;
  grain: Words;
  sources: string[];
}[];
const domains = ["receivables", "sales", "customers", "inventory"];
const sources = ["xero", "hubspot", "shopify", "stripe"];
const names: Record<Layer, Words> = {
  input: words("Chuẩn hóa bản ghi", "Standardise records"),
  transform: words("Đối chiếu dữ liệu", "Reconcile data"),
  output: words("Tổng hợp phân tích", "Analytics summary"),
  unclassified: words("Model chưa phân lớp", "Unclassified model"),
};
const prefixes: Record<Layer, string> = {
  input: "stg",
  transform: "int",
  output: "mart",
  unclassified: "custom",
};

/** All semantic metadata is explicitly authored here; production must never infer it from prefixes. */
export function createCatalog(scale = 250): Catalog {
  const models: ModelRecord[] = anchors.map((anchor, index) => ({
    ...anchor,
    coverage: "complete",
    family: prefixes[anchor.layer],
    status: index === 1 ? "failed" : "success",
    builtAt: "2026-10-10T01:00:00Z",
  }));
  const quotas: [Layer, number][] = [
    ["input", scale / 5],
    ["transform", (scale * 2) / 5],
    ["output", (scale * 36) / 100],
    ["unclassified", (scale * 4) / 100],
  ];
  for (const [layer, quota] of quotas) {
    const existing = models.filter((model) => model.layer === layer).length;
    for (let index = existing; index < quota; index += 1) {
      models.push(generatedModel(layer, index));
    }
  }
  const edges = [
    { source: "raw.records", target: "stg_invoices" },
    { source: "raw.records", target: "stg_payments" },
    { source: "stg_invoices", target: "int_invoice_balance" },
    { source: "stg_payments", target: "int_invoice_balance" },
    { source: "int_invoice_balance", target: "mart_receivables" },
    { source: "stg_invoices", target: "mart_daily_revenue" },
    { source: "stg_deals", target: "int_customer_identity" },
    { source: "stg_invoices", target: "int_customer_identity" },
  ];
  for (const model of models) {
    if (model.layer === "transform" && model.id.startsWith("int_demo")) {
      edges.push({ source: "stg_invoices", target: model.id });
    }
    if (model.layer === "output" && model.id.startsWith("mart_demo")) {
      edges.push({ source: "int_invoice_balance", target: model.id });
    }
  }
  return { models, edges, revision: `synthetic-${scale}-v1` };
}

function generatedModel(layer: Layer, index: number): ModelRecord {
  const ordinal = String(index + 1).padStart(3, "0");
  const title = names[layer];
  const engineeringDemo = layer === "transform" && ordinal === "011";
  return {
    id: `${prefixes[layer]}_demo_${ordinal}`,
    title: words(`${title.vi} · ${ordinal}`, `${title.en} · ${ordinal}`),
    description: engineeringDemo
      ? words(
          "Chuẩn bị hóa đơn để đối chiếu và kiểm tra mã khách hàng trước khi tổng hợp công nợ.",
          "Prepare invoices for reconciliation and check customer identifiers before receivables aggregation.",
        )
      : words(
          "Dữ liệu minh họa được khai báo cho prototype.",
          "Synthetic metadata declared for this prototype.",
        ),
    grain: engineeringDemo
      ? words("Một hóa đơn và một đồng tiền gốc.", "One invoice and one original currency.")
      : null,
    layer,
    domain: engineeringDemo
      ? "receivables"
      : index % 11 === 0
        ? null
        : (domains[index % 4] ?? null),
    sources: engineeringDemo ? ["xero"] : index % 13 === 0 ? [] : [sources[index % 4] ?? "xero"],
    coverage: index % 13 === 0 ? "unknown" : "complete",
    family: prefixes[layer],
    status: index % 17 === 0 ? "never" : "success",
    builtAt: index % 17 === 0 ? null : "2026-10-10T01:00:00Z",
  };
}
