import type { EngineeringProfile } from "@/features/models-workspace/profileSource.ts";

const exampleTests: EngineeringProfile["tests"] = [
  {
    name: "unique_invoice_currency",
    status: "pass",
    failures: 0,
    explanation: {
      vi: "Không trùng tổ hợp mã hóa đơn và đồng tiền.",
      en: "No duplicate invoice and currency combinations.",
    },
  },
  {
    name: "not_null_invoice_id",
    status: "pass",
    failures: 0,
    explanation: { vi: "Mọi dòng có mã hóa đơn.", en: "Every row has an invoice ID." },
  },
  {
    name: "accepted_values_currency",
    status: "pass",
    failures: 0,
    explanation: {
      vi: "Đồng tiền nằm trong danh sách đã khai báo.",
      en: "Currencies belong to the declared list.",
    },
  },
  {
    name: "not_null_customer_id",
    status: "warn",
    failures: 38,
    explanation: {
      vi: "38 dòng thiếu mã khách hàng; kiểm tra ánh xạ ở đầu vào. Test đặt mức cảnh báo nên không chặn build.",
      en: "38 rows lack customer IDs; inspect input mappings. Warning severity does not block the build.",
    },
  },
];

/** Authored evidence for two synthetic examples, never a fallback for arbitrary models. */
export function engineeringExample(id: string): EngineeringProfile {
  return {
    owner: "Data Platform · demo",
    key: ["invoice_id", "currency"],
    caveat: {
      vi: "38 dòng thiếu mã khách hàng. Có thể đối chiếu theo hóa đơn; cần xử lý trước khi tổng hợp theo khách hàng. Không cộng tiền khác đồng tiền.",
      en: "38 rows lack a customer ID. Invoice reconciliation is possible; resolve these before aggregating by customer. Never sum different currencies.",
    },
    relation: `demo_warehouse.analytics.${id}`,
    path: `models/intermediate/${id}.sql`,
    uniqueId: `model.undercroft_demo.${id}`,
    tags: ["finance", "receivables"],
    contract: { vi: "Chưa bật ràng buộc schema (contract)", en: "Schema contract is not enforced" },
    access: "protected",
    measuredAt: "2026-10-10T01:02:00Z",
    environment: "demo",
    sqlComparison: {
      vi: "Chưa có bằng chứng đối chiếu SQL đã lưu với lần chạy thành công",
      en: "No evidence comparing saved SQL with the successful run",
    },
    tests: exampleTests,
    runs: [
      {
        id: "demo-run-103",
        at: "2026-10-10T01:00:00Z",
        status: "success",
        durationMs: 1840,
        explanation: {
          vi: "Tạo view thành công. Kết quả kiểm thử được trình bày riêng phía trên.",
          en: "View created successfully. Test results are shown separately above.",
        },
      },
      {
        id: "demo-run-102",
        at: "2026-10-09T01:00:00Z",
        status: "failed",
        durationMs: 620,
        explanation: {
          vi: "column i.customer_id does not exist — nguồn thiếu cột. Kiểm tra schema đầu vào và SQL đã lưu trước khi chạy lại.",
          en: "column i.customer_id does not exist — input column missing. Check the input schema and saved SQL before rerunning.",
        },
      },
      {
        id: "demo-run-101",
        at: "2026-10-08T01:00:00Z",
        status: "success",
        durationMs: 1760,
        explanation: { vi: "Tạo view thành công.", en: "View created successfully." },
      },
    ],
  };
}
