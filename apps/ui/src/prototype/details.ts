import type { ModelDetails, ModelSample } from "@/features/models-workspace/profileSource.ts";
import { engineeringExample } from "./engineering.ts";

const detail: ModelDetails = {
  columns: [
    {
      name: "invoice_id",
      type: "text",
      description: { vi: "Mã hóa đơn", en: "Invoice identifier" },
    },
    {
      name: "customer_id",
      type: "text",
      description: { vi: "Mã khách hàng", en: "Customer identifier" },
    },
    {
      name: "currency",
      type: "text",
      description: { vi: "Đồng tiền gốc", en: "Original currency" },
    },
    {
      name: "invoice_amount",
      type: "numeric",
      description: { vi: "Giá trị hóa đơn", en: "Invoice amount" },
    },
    {
      name: "paid_amount",
      type: "numeric",
      description: { vi: "Đã thanh toán", en: "Paid amount" },
    },
    {
      name: "balance",
      type: "numeric",
      description: { vi: "Còn phải thu", en: "Outstanding amount" },
    },
  ],
  sql: `-- Synthetic example; each input declares one row per invoice and currency.
select
  i.invoice_id,
  i.customer_id,
  i.currency,
  i.invoice_amount,
  p.paid_amount,
  i.invoice_amount - p.paid_amount as balance
from {{ ref('stg_invoices') }} i
left join (
  select invoice_id, currency, sum(paid_amount) as paid_amount
  from {{ ref('stg_payments') }}
  group by invoice_id, currency
) p on i.invoice_id = p.invoice_id and i.currency = p.currency
-- Unavailable payment evidence stays NULL; it is never guessed to be zero.`,
  materialization: "view",
  durationMs: 1840,
  rowCount: "12480",
  engineering: engineeringExample("int_invoice_balance"),
};
const sample: ModelSample = {
  columns: detail.columns.map((column) => column.name),
  rows: [
    [
      { text: "INV-DEMO-001" },
      { text: "CUST-DEMO-001" },
      { text: "USD" },
      { text: "1000", currency: "USD" },
      { text: "600", currency: "USD" },
      { text: "400", currency: "USD" },
    ],
  ],
};
export function readDetails(id: string): ModelDetails | null {
  if (id === "int_demo_011") {
    return {
      ...detail,
      columns: detail.columns.slice(0, 4),
      sql: "select invoice_id, customer_id, currency, invoice_amount\nfrom {{ ref('stg_invoices') }}",
      engineering: engineeringExample(id),
    };
  }
  return id === "int_invoice_balance" ? detail : null;
}
export function readSample(id: string): ModelSample | null {
  if (id === "int_demo_011") {
    return { columns: sample.columns.slice(0, 4), rows: sample.rows.map((row) => row.slice(0, 4)) };
  }
  return id === "int_invoice_balance" ? sample : null;
}
