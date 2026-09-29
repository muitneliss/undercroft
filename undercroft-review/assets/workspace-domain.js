/* Synthetic review data and pure rules. Production keeps its existing tRPC contracts. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WorkspaceDomain = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const own = (role) => role === "admin" || role === "member";
  const normalize = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  // Exact fixed-scale arithmetic for fixtures. Shipping code must reuse big.js/formatMoney.
  function units(value) {
    if (typeof value !== "string" || !/^-?\d+(\.\d{1,4})?$/.test(value)) return null;
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const v = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
    return negative ? -v : v;
  }
  function decimal(value) {
    if (value === null) return null;
    const sign = value < 0n ? "-" : "", n = value < 0n ? -value : value;
    return sign + n / 10000n + "." + String(n % 10000n).padStart(4, "0");
  }
  function sum(values) {
    if (!values.length) return null;
    const parsed = values.map(units);
    return parsed.some((v) => v === null) ? null : decimal(parsed.reduce((a, b) => a + b, 0n));
  }
  function money(value) {
    if (units(value) === null) return "—";
    const [whole, fraction = ""] = value.split(".");
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction.padEnd(2, "0").slice(0, 2);
  }
  // A pixel position is the only approximate value; labels and exports keep the strings.
  function position(value, maximum, extent) {
    const v = units(value), max = units(maximum);
    if (v === null || max === null || max <= 0n) return null;
    return Number(v * 100000n / max) / 100000 * extent;
  }
  function safeCsv(rows) {
    return rows.map((r) => r.map((v) => {
      let text = String(v ?? "");
      if (/^[=+@\t\r]/.test(text) || /^-\D/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    }).join(",")).join("\r\n");
  }
  function seed() {
    const tenants = [
      { id: "CASE-0042", name: "Demo Co.", role: "admin", created: "2026-09-01T01:00:00Z" },
      { id: "CASE-0067", name: "Atlas Example", role: "member", created: "2026-09-10T01:00:00Z" },
      { id: "CASE-0081", name: "Paper & Pine Demo", role: "viewer", created: "2026-09-20T01:00:00Z" },
    ];
    const periods = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const values = {
      services: ["58000.2500", "62000.0000", "61000.7500", "67000.0000", "73500.2500", "78000.5000"],
      products: ["36500.0000", "38000.2500", "42000.0000", "43000.0000", "44700.2500", "50600.0000"],
    };
    const revenue = periods.flatMap((period, i) => Object.entries(values).map(([segment, v]) => ({ period, segment, revenue: v[i], currency: "SGD" })));
    const invoices = [
      ["INV-DEMO-001", "Example North", "services", "2026-09-03", "2026-09-18", "4800.0000", "overdue", "1–30"],
      ["INV-DEMO-002", "Example East", "products", "2026-09-05", "2026-10-05", "3250.5000", "open", "current"],
      ["INV-DEMO-003", "Example North", "services", "2026-07-20", "2026-08-19", "9600.0000", "overdue", "31–60"],
      ["INV-DEMO-004", "Example Studio", "products", "2026-09-10", "2026-09-25", "2120.2500", "overdue", "1–30"],
      ["INV-DEMO-005", "Example South", "services", "2026-09-12", "2026-10-12", "14500.0000", "open", "current"],
      ["INV-DEMO-006", "Example East", "products", "2026-06-10", "2026-07-10", "4200.0000", "overdue", "61+"],
      ["INV-DEMO-007", "Example Studio", "services", "2026-09-18", "2026-10-18", "5800.7500", "open", "current"],
      ["INV-DEMO-008", "Example South", "products", "2026-09-20", "2026-10-20", null, "open", "current"],
    ].map(([id, customer, segment, issued, due, amount, status, age]) => ({ id, customer, segment, issued, due, amount, status, age, currency: "SGD" }));
    const questions = [
      { id: "q-revenue", name: "Doanh thu theo tháng", nameEn: "Monthly revenue", description: "Doanh thu đã ghi nhận theo tháng và nhóm hoạt động.", descriptionEn: "Recognised revenue by month and business segment.", model: "revenue_monthly", dataset: "revenue", kind: "visual", chart: "line", updated: "2026-09-28T08:00:00Z", author: "analyst@example.test" },
      { id: "q-segment", name: "Đóng góp theo nhóm", nameEn: "Revenue by segment", description: "So sánh các nhóm trên cùng một trục đo.", descriptionEn: "Compare business segments on one scale.", model: "revenue_monthly", dataset: "segment", kind: "visual", chart: "bar", updated: "2026-09-28T08:00:00Z", author: "analyst@example.test" },
      { id: "q-aging", name: "Công nợ theo tuổi", nameEn: "Receivables by age", description: "Số tiền còn phải thu tại ngày 29/09/2026; một hóa đơn thiếu số tiền.", descriptionEn: "Outstanding balances as of 29 Sep 2026; one invoice has no amount.", model: "ar_open_items", dataset: "aging", kind: "visual", chart: "bar", updated: "2026-09-27T08:00:00Z", author: "operator@example.test" },
      { id: "q-invoices", name: "Sổ công nợ chi tiết", nameEn: "Open invoice ledger", description: "Từng hóa đơn, hạn thanh toán và số tiền gốc.", descriptionEn: "Individual invoices, due dates and original amounts.", model: "ar_open_items", dataset: "invoices", kind: "sql", chart: "table", updated: "2026-09-27T08:00:00Z", author: "operator@example.test" },
      { id: "q-support", name: "Lý do hoàn tiền", nameEn: "Refund reasons", description: "Chưa có kết quả: mô hình chưa dựng.", descriptionEn: "No result yet: the model has never been built.", model: "refund_reasons", dataset: "support", kind: "visual", chart: "bar", updated: "2026-09-29T08:00:00Z", author: "analyst@example.test" },
    ];
    questions.forEach((q) => { q.sql = q.dataset === "invoices" ? 'select id, customer, due, amount, currency\nfrom ar_open_items\nwhere segment = {{segment}}\norder by due;' : `select * from ${q.model};`; });
    const dashboards = [
      { id: "d-performance", name: "Nhịp kinh doanh", nameEn: "Business performance", description: "Doanh thu đang đi đâu, và nhóm nào đóng góp?", descriptionEn: "Where is revenue heading, and which segments contribute?", tiles: ["q-revenue", "q-segment"], updated: "2026-09-28T08:00:00Z", author: "analyst@example.test" },
      { id: "d-receivables", name: "Công nợ phải thu", nameEn: "Accounts receivable", description: "Khoản nào đã quá hạn, và cần kiểm tra hóa đơn nào?", descriptionEn: "Which balances are overdue, and which invoices need inspection?", tiles: ["q-aging", "q-invoices"], updated: "2026-09-27T08:00:00Z", author: "operator@example.test" },
      { id: "d-support", name: "Chất lượng dịch vụ", nameEn: "Service quality", description: "Nhìn thấy cả trường hợp chưa có dữ liệu để báo cáo.", descriptionEn: "A report that makes unavailable data explicit.", tiles: ["q-support"], updated: "2026-09-29T08:00:00Z", author: "analyst@example.test" },
    ];
    const people = [
      { id: "p-operator", name: "Demo Operator", email: "operator@example.test", role: "admin" },
      { id: "p-analyst", name: "Demo Analyst", email: "analyst@example.test", role: "member" },
      { id: "p-reader", name: "Demo Reader", email: "reader@example.test", role: "viewer" },
    ];
    const invitations = [{ id: "i-001", email: "reviewer@example.test", role: "viewer", expires: "2026-10-06T08:00:00Z" }];
    return { tenants, revenue, invoices, questions, dashboards, people, invitations };
  }
  function permittedMembershipChange(members, email, nextRole) {
    const member = members.find((m) => m.email === email);
    if (!member) return "not-member";
    if (member.role === "admin" && nextRole !== "admin" && members.filter((m) => m.role === "admin").length === 1) return "last-admin";
    return null;
  }
  function filteredRevenue(data, params) {
    return data.filter((r) => (!params.period_from || r.period >= params.period_from.slice(0, 7)) && (!params.period_to || r.period <= params.period_to.slice(0, 7)) && (!params.segment || params.segment === "all" || r.segment === params.segment));
  }
  function group(rows, key, value) {
    return [...new Set(rows.map((r) => r[key]))].map((label) => ({ label, value: sum(rows.filter((r) => r[key] === label).map((r) => r[value])), incomplete: rows.some((r) => r[key] === label && r[value] === null) }));
  }
  return { seed, clone, normalize, own, units, decimal, sum, money, position, safeCsv, group, filteredRevenue, permittedMembershipChange };
});
