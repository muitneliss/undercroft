/* Local UI review: Customers, Reports and People. No server or external calls. */
window.createWorkspace = function (ui) {
  "use strict";
  const W = window.WorkspaceDomain;
  const { t, esc, url, link, button, field, input, select, submit, stamp, fact, table, tabs, crumbs, frame, notice, role, admin, go, render, write } = ui;
  const data = W.seed(), books = new Map(), drafts = new Map(), results = new Map();
  const current = () => ui.current();
  const params = () => current().params;
  const tenantId = () => params().tenant || "CASE-0042";
  const tenant = () => data.tenants.find((row) => row.id === tenantId());
  const canAuthor = () => W.own(role());
  const platform = () => params().platform === "1";
  const nameOf = (item) => params().lang === "en" ? item.nameEn || item.name : item.name;
  const descriptionOf = (item) => params().lang === "en" ? item.descriptionEn || item.description : item.description;
  const roleName = (r) => ({ admin: t("Quản trị", "Administrator"), member: t("Thành viên", "Member"), viewer: t("Chỉ xem", "Viewer") })[r];
  const roleOptions = () => ["viewer", "member", "admin"].map((r) => [r, roleName(r)]);
  const b = (act, label, id = "", primary = false, disabled = false) => button("ws-" + act, label, primary, disabled || ui.pending(), `data-id="${esc(id)}"`);
  const badge = (word, state = "") => `<span class="status ${state}"><span aria-hidden="true">${state === "error" ? "◆" : state === "warning" ? "◐" : "●"}</span>${esc(word)}</span>`;
  const empty = (title, body, action = "") => `<section class="ws-empty"><span class="folio-symbol" aria-hidden="true">▤</span><h2>${esc(title)}</h2><p class="prose">${esc(body)}</p>${action}</section>`;
  const info = (content) => `<p class="prose ws-note">${content}</p>`;
  function book() {
    if (!books.has(tenantId())) books.set(tenantId(), tenantId() === "CASE-0042" ? W.clone({ questions: data.questions, dashboards: data.dashboards, people: data.people, invitations: data.invitations }) : { questions: [], dashboards: [], people: [{ id: "p-operator", name: "Demo Operator", email: "operator@example.test", role: tenant()?.role || "admin" }], invitations: [] });
    return books.get(tenantId());
  }
  const key = (kind, id) => `${tenantId()}:${kind}:${id}`;
  function draft(kind, id, value) {
    const k = key(kind, id);
    if (!drafts.has(k)) drafts.set(k, W.clone(value));
    return drafts.get(k);
  }
  const context = (extra = {}) => ({ period_from: params().period_from, period_to: params().period_to, segment: params().segment, from: params().from, ...extra });
  const segmentName = (value) => value === "services" ? t("Dịch vụ", "Services") : value === "products" ? t("Sản phẩm", "Products") : t("Tất cả nhóm", "All segments");
  function filterValues() {
    return { period_from: params().period_from || "2026-04-01", period_to: params().period_to || "2026-09-30", segment: params().segment || "all" };
  }
  function filters(path, mode = "revenue") {
    const f = filterValues();
    return `<form class="report-filters" data-form="ws-report-filter" data-id="${esc(path)}">${mode === "revenue" ? field(t("Từ tháng", "From month"), input("period_from", f.period_from.slice(0, 7), "", 'type="month" required')) + field(t("Đến tháng", "To month"), input("period_to", f.period_to.slice(0, 7), "", 'type="month" required')) : `<div class="asof"><span class="label">${esc(t("Ngày chốt số liệu", "As-of date"))}</span><span class="mono">29/09/2026</span></div>`}${field(t("Nhóm hoạt động", "Business segment"), select("segment", [["all", segmentName("all")], ["services", segmentName("services")], ["products", segmentName("products")]], f.segment))}<div class="actions">${submit(t("Áp dụng", "Apply"))}${link(path, t("Đặt lại", "Reset"), { from: params().from }, "text-link")}</div></form>`;
  }
  function customersPage() {
    const query = params().q || "", filter = params().access || "all";
    const list = data.tenants.filter((r) => W.normalize(r.name + " " + r.id).includes(W.normalize(query)) && (filter === "all" || r.role === filter));
    const selected = tenant();
    return frame("customers", t("Hồ sơ khách hàng", "Customer index"), t("Mỗi khách hàng là một cuốn hồ sơ riêng. Chọn đúng hồ sơ trước khi đọc hoặc làm việc với dữ liệu.", "One case book per customer. Choose the right book before reading or working with its data."),
      `<div class="workspace-current"><div><span class="label">${esc(t("Hồ sơ đang mở", "Currently open"))}</span><p><strong>${esc(selected?.name || "—")}</strong> <span class="mono">${esc(selected?.id || "—")}</span></p></div>${link("sources", t("Tiếp tục hồ sơ →", "Continue in this book →"), {}, "plate")}</div>
      <div class="toolbar"><p class="prose">${esc(t("Chỉ hiển thị khách hàng bạn được phép truy cập.", "Only customers you are allowed to access appear here."))}</p>${platform() ? link("customer-new", t("Tạo khách hàng", "Create customer"), {}, "plate plate-primary") : ""}</div>
      <form class="filters" data-form="ws-customer-filter">${field(t("Tìm tên hoặc mã khách hàng", "Find customer name or ID"), input("q", query, t("Tên hoặc CASE-…", "Name or CASE-…")))}${field(t("Quyền của bạn", "Your access"), select("access", [["all", t("Tất cả", "All")], ...roleOptions()], filter))}<div class="actions">${submit(t("Tìm", "Search"))}${query || filter !== "all" ? link("customers", t("Xóa bộ lọc", "Clear filters")) : ""}</div></form>
      <p class="results">${list.length} / ${data.tenants.length} ${esc(t("khách hàng được cấp quyền", "accessible customers"))}</p>
      <div class="case-index">${list.map((row, index) => `<article class="case-row"><span class="case-number mono">${String(index + 1).padStart(2, "0")}</span><div><h2>${link("customer/" + row.id, row.name, { tenant: row.id, role: row.role })}</h2><p class="mono quiet">${esc(row.id)}</p></div><div class="case-access"><span class="label">${esc(t("Quyền của bạn", "Your access"))}</span><p>${esc(roleName(row.role))}</p></div><div class="actions">${row.id === tenantId() ? `<span class="label punched">${esc(t("Đang mở", "Open"))}</span>` : ""}${link("sources", t("Mở hồ sơ →", "Open book →"), { tenant: row.id, role: row.role }, "plate")}</div></article>`).join("") || empty(t("Không tìm thấy khách hàng", "No customers found"), t("Thử tên ngắn hơn hoặc bỏ lọc quyền.", "Try a shorter name or clear the role filter."), link("customers", t("Xóa bộ lọc", "Clear filters"), {}, "plate"))}</div>
      ${info(esc(t("Quản trị khách hàng chỉ quản lý hồ sơ được cấp. Tạo khách hàng mới cần quyền quản trị nền tảng.", "A tenant administrator manages the book they are assigned. Creating a customer requires platform administrator authority.")))}`);
  }
  function customerPage(id) {
    const row = data.tenants.find((r) => r.id === id);
    if (!row || row.id !== tenantId()) return unavailable("customers");
    const rename = params().edit === "1" && admin();
    const d = draft("tenant", id, { name: row.name });
    return frame("customers", row.name, t("Định danh giữ nguyên; tên hiển thị có thể được quản trị viên cập nhật.", "The identifier is permanent; an administrator can correct the display name."), `${crumbs([["customers", t("Khách hàng", "Customers")], [null, row.id]])}<div class="fact-grid">${fact(t("Mã khách hàng", "Customer ID"), esc(row.id))}${fact(t("Quyền của bạn", "Your role"), esc(roleName(role())))}${fact(t("Ngày tạo", "Created"), stamp(row.created))}${fact(t("Phạm vi", "Scope"), esc(t("Riêng khách hàng này", "This customer only")))}</div>
      <div class="actions">${link("sources", t("Mở nguồn dữ liệu →", "Open data sources →"), {}, "plate plate-primary")}${link("reports", t("Đọc báo cáo", "Read reports"), {}, "plate")}${link("people", t("Xem người dùng", "View people"), {}, "plate")}${admin() && !rename ? link("customer/" + id, t("Sửa tên", "Edit name"), { edit: "1" }, "plate") : ""}</div>
      ${rename ? `<section class="source-detail"><h2>${esc(t("Sửa tên hiển thị", "Correct display name"))}</h2><form data-form="ws-rename" data-id="${esc(id)}">${field(t("Tên hiển thị", "Display name"), input("name", d.name, "", 'maxlength="200"'))}${info(esc(t("Mã khách hàng không thay đổi. Các bản ghi và quyền truy cập vẫn gắn với mã cũ.", "The customer ID stays unchanged. Records and memberships remain attached to that ID.")))}<div class="actions">${submit(t("Lưu tên trong bản mẫu", "Save name in prototype"))}${b("discard-tenant", t("Bỏ thay đổi", "Discard changes"), id)}</div></form></section>` : ""}
      <section class="route-directory"><h2>${esc(t("Bên trong hồ sơ", "Inside this book"))}</h2>${[["sources", t("Nguồn & phạm vi đọc", "Sources & read scope"), t("Dữ liệu đến từ tài khoản nào?", "Which account does the data come from?")], ["journal", t("Nhật ký", "Journal"), t("Lần chạy nào đã thành công hoặc bị từ chối?", "Which runs succeeded or were refused?")], ["lake", t("Hồ dữ liệu thô", "Raw lake"), t("Bản gốc nào đã được lưu?", "Which originals were preserved?")], ["models", t("Mô hình", "Models"), t("Dữ liệu được biến đổi thế nào?", "How is the data transformed?")], ["reports", t("Báo cáo", "Reports"), t("Những con số trả lời câu hỏi gì?", "Which questions do the figures answer?")], ["people", t("Người dùng", "People"), t("Ai có thể xem và ai có thể thay đổi?", "Who can read and who can change things?")]].map(([path, title, desc]) => `<div>${link(path, title)}<span class="prose quiet">${esc(desc)}</span></div>`).join("")}</section>`);
  }
  function newCustomerPage() {
    const d = draft("tenant", "new", { id: "", name: "" });
    return frame("customers", t("Tạo khách hàng", "Create customer"), t("Một định danh trung tính cho một hồ sơ độc lập.", "One neutral identifier for one independent case book."), `${crumbs([["customers", t("Khách hàng", "Customers")], [null, t("Tạo mới", "Create")]])}${!platform() ? empty(t("Cần quyền quản trị nền tảng", "Platform administrator required"), t("Quyền quản trị trong một khách hàng không cho phép tạo khách hàng khác.", "Administration of one customer does not permit creating another customer.")) : `<form class="ws-form" data-form="ws-customer-create">${field(t("Mã khách hàng · không đổi sau khi tạo", "Customer ID · permanent"), input("id", d.id, "CASE-0092", 'required pattern="CASE-[0-9]{4,}"'))}${field(t("Tên hiển thị", "Display name"), input("name", d.name, t("Tên công ty mẫu", "Example company"), 'maxlength="200"'))}${info(esc(t("Bản mẫu chỉ nhận mã CASE và dữ liệu giả lập. Việc tạo này chỉ nằm trong tab trình duyệt.", "This review accepts CASE identifiers and synthetic data. Creation affects only this browser tab.")))}<div class="actions">${submit(t("Tạo trong bản mẫu", "Create in prototype"))}${link("customers", t("Quay lại", "Back"), {}, "plate")}</div></form>`}`);
  }
  function reportsPage() {
    const q = params().q || "", view = params().view || "dashboards";
    const list = (view === "questions" ? book().questions : book().dashboards).filter((r) => W.normalize(nameOf(r) + " " + descriptionOf(r)).includes(W.normalize(q)));
    const catalogTabs = tabs("reports", [["dashboards", t("Bảng điều hành", "Dashboards") + ` · ${book().dashboards.length}`], ["questions", t("Câu hỏi đã lưu", "Saved questions") + ` · ${book().questions.length}`]], view, { q });
    return frame("reports", t("Báo cáo", "Reports"), t("Từ một câu hỏi rõ ràng đến con số có thể kiểm tra. Mỗi báo cáo giữ nguyên ngữ cảnh của khách hàng.", "From a clear question to figures you can inspect. Every report stays inside this customer's context."), `${catalogTabs}<div class="toolbar"><p class="prose quiet">${esc(view === "questions" ? t("Một câu hỏi là một truy vấn đã lưu cùng cách trình bày kết quả.", "A question is a saved query and its result presentation.") : t("Một bảng điều hành tập hợp các câu hỏi dưới cùng bộ lọc.", "A dashboard assembles saved questions under shared filters."))}</p>${canAuthor() ? link(view === "questions" ? "question/new" : "dashboard/new", view === "questions" ? t("Tạo câu hỏi", "New question") : t("Tạo bảng điều hành", "New dashboard"), { edit: "1" }, "plate plate-primary") : `<span class="label">${esc(t("Quyền chỉ xem", "Read-only access"))}</span>`}</div>
      <form class="ws-search" data-form="ws-report-search">${field(t("Tìm báo cáo", "Find a report"), input("q", q, t("Tên hoặc nội dung…", "Name or description…")))}<input type="hidden" name="view" value="${esc(view)}">${submit(t("Tìm", "Search"))}${q ? link("reports", t("Xóa lọc", "Clear"), { view }) : ""}</form>
      ${list.length ? `<div class="report-catalog">${list.map((item, i) => `<article class="report-catalog-row"><div class="report-mini" aria-hidden="true">${mini(view === "questions" ? item.chart : i === 1 ? "bar" : "line")}</div><div><span class="label quiet">${esc(view === "questions" ? item.kind === "sql" ? "SQL" : t("Trực quan", "Visual") : `${item.tiles.length} ${t("câu hỏi", "questions")}`)}</span><h2>${link((view === "questions" ? "question/" : "dashboard/") + item.id, nameOf(item))}</h2><p class="prose">${esc(descriptionOf(item))}</p><span class="mono quiet">${esc(t("Sửa định nghĩa", "Definition edited"))}: ${stamp(item.updated)}</span></div><div class="report-catalog-end">${link((view === "questions" ? "question/" : "dashboard/") + item.id, t("Mở →", "Open →"), {}, "plate")}<span class="mono quiet">${esc(item.author)}</span></div></article>`).join("")}</div>` : empty(q ? t("Không có kết quả phù hợp", "No matching reports") : t("Chưa có báo cáo", "No reports yet"), q ? t("Thử tìm theo tên ngắn hơn hoặc xóa bộ lọc.", "Try a shorter name or clear the filter.") : canAuthor() ? t("Bắt đầu bằng một câu hỏi từ bảng mô hình đã dựng.", "Start with a question over a built model table.") : t("Thành viên hoặc quản trị viên có thể tạo báo cáo cho hồ sơ này.", "A member or administrator can create reports for this book."), q ? link("reports", t("Xóa bộ lọc", "Clear filters"), { view }, "plate") : canAuthor() ? link("question/new", t("Tạo câu hỏi đầu tiên", "Create the first question"), { edit: "1" }, "plate") : "")}
      ${info(esc(t("Ảnh thu nhỏ biểu thị kiểu trình bày, không phải dữ liệu trực tiếp. Ngày sửa định nghĩa không phải ngày dữ liệu được làm mới.", "Thumbnails indicate presentation type, not live results. Definition edit time is not data freshness.")))}`);
  }
  function mini(type) {
    return `<svg viewBox="0 0 116 64" fill="none"><path d="M5 55H111M5 33H111M5 11H111" stroke="currentColor" opacity=".12"/>${type === "table" ? '<path d="M8 13H106M8 24H106M8 35H106M8 46H106M42 8V53M77 8V53" stroke="currentColor" opacity=".7"/>' : type === "bar" ? '<path d="M14 53V31M35 53V17M56 53V26M77 53V8M98 53V19" stroke="currentColor" stroke-width="11"/>' : '<path d="M6 46L25 34L43 39L63 19L81 24L108 6" stroke="currentColor" stroke-width="2"/><path d="M6 52L25 46L43 49L63 35L81 38L108 29" stroke="currentColor" stroke-dasharray="4 4"/>'}</svg>`;
  }
  function questionResult(q) {
    const f = filterValues();
    if (q.executable === false) return { state: "unsupported", rows: [], columns: [] };
    if (q.dataset === "support") return { state: "unbuilt", rows: [], columns: [] };
    if (q.dataset === "revenue" || q.dataset === "segment") {
      const rows = W.filteredRevenue(data.revenue, f);
      return { state: rows.length ? "ok" : "empty", rows: W.group(rows, q.dataset === "segment" ? "segment" : "period", "revenue"), columns: [q.dataset === "segment" ? "segment" : "month", "revenue", "currency"] };
    }
    const invoices = data.invoices.filter((r) => f.segment === "all" || r.segment === f.segment);
    if (q.dataset === "invoices") return { state: invoices.length ? "ok" : "empty", rows: invoices, columns: ["id", "customer", "due", "amount", "currency"] };
    const ageOrder = ["current", "1–30", "31–60", "61+"];
    const rows = W.group(invoices, "age", "amount").sort((a, b) => ageOrder.indexOf(a.label) - ageOrder.indexOf(b.label));
    return { state: rows.length ? "ok" : "empty", rows, columns: ["age", "amount", "currency"] };
  }
  function dataTable(q, answer) {
    if (q.dataset === "invoices") return table([t("Hóa đơn", "Invoice"), t("Đối tác mẫu", "Example counterparty"), t("Đến hạn", "Due"), "SGD", t("Tình trạng", "Status")], answer.rows.map((r) => [esc(r.id), esc(r.customer), esc(r.due), `<span class="num">${W.money(r.amount)}</span>`, badge(r.amount === null ? t("Thiếu số tiền", "Missing amount") : r.status === "overdue" ? t("Quá hạn", "Overdue") : t("Chưa đến hạn", "Not yet due"), r.amount === null || r.status === "overdue" ? "warning" : "")]), nameOf(q));
    return table([q.dataset === "segment" ? t("Nhóm", "Segment") : q.dataset === "aging" ? t("Tuổi nợ", "Age bucket") : t("Tháng", "Month"), "SGD", t("Ghi chú", "Note")], answer.rows.map((r) => [esc(q.dataset === "segment" ? segmentName(r.label) : r.label === "current" ? t("Chưa đến hạn", "Current") : r.label), `<span class="num">${W.money(r.value)}</span>`, r.incomplete ? esc(t("Chưa cộng: có số tiền thiếu", "Not totalled: an amount is missing")) : params().focus === r.label ? `<span class="punched">${esc(t("Điểm đã chọn", "Selected point"))}</span>` : "—"]), nameOf(q));
  }
  function plot(q, answer, type = q.chart, dashboardId = "") {
    if (answer.state === "unsupported") return empty(t("Định nghĩa đã lưu, chưa có kết quả", "Definition saved; no result available"), t("SQL tùy ý không được thực thi trong bản mẫu. Không dùng kết quả mẫu để thay cho truy vấn này.", "Arbitrary SQL is not executed in this review. Sample results cannot stand in for this query."));
    if (answer.state === "unbuilt") return empty(t("Chưa có kết quả để vẽ", "No result to draw"), t("refund_reasons chưa từng dựng. Đây là thiếu dữ liệu, không phải 0 trường hợp hoàn tiền.", "refund_reasons has never been built. This is missing data, not zero refunds."), role() !== "viewer" ? link("model/refund_reasons", t("Xem mô hình →", "Inspect model →"), {}, "plate") : "");
    if (answer.state === "empty") return empty(t("Không có dòng trong khoảng đã chọn", "No rows in this range"), t("Thử khoảng tháng 04–09/2026 của dữ liệu mẫu.", "Try Apr–Sep 2026 for this fixture."));
    if (type === "table" || type === "pivot" || q.dataset === "invoices") return dataTable(q, answer);
    const rows = answer.rows, valid = rows.filter((r) => r.value !== null);
    if (type === "number") return `<div class="big-reading"><span class="label">SGD</span><strong>${W.money(W.sum(rows.map((r) => r.value)))}</strong><p class="prose">${esc(t("Tổng của các hàng kết quả đang hiển thị", "Total of the current result rows"))}</p></div>`;
    const max = valid.reduce((m, r) => W.units(r.value) > W.units(m) ? r.value : m, "1.0000");
    const editing = params().edit === "1" || q.id === "new";
    const pointUrl = (label) => esc(url("question/" + q.id, context({ view: "data", focus: label, from: dashboardId || params().from })));
    const pointHref = (label) => editing ? "" : `href="${pointUrl(label)}"`;
    const labelOf = (r) => q.dataset === "segment" ? segmentName(r.label) : r.label === "current" ? t("Chưa đến hạn", "Current") : r.label;
    if (type === "bar") return `<div class="bar-plot" aria-label="${esc(nameOf(q))}"><p class="chart-unit">SGD · ${esc(t("Trục bắt đầu tại 0", "Axis starts at zero"))}</p>${rows.map((r) => `<a class="bar-row" ${pointHref(r.label)} aria-label="${esc(labelOf(r))}: ${W.money(r.value)} SGD; ${esc(t("xem hàng kết quả", "view result row"))}"><span>${esc(labelOf(r))}</span><span class="bar-track">${r.value === null ? `<span class="missing-bar">${esc(t("Chưa đủ dữ liệu", "Incomplete"))}</span>` : `<i style="width:${W.position(r.value, max, 100)}%"></i>`}</span><strong>${W.money(r.value)}</strong></a>`).join("")}<p class="chart-caption">${esc(editing ? t("Xem thử trước khi lưu. Số liệu gốc ở bên dưới.", "Preview before saving. Exact data is below.") : t("Chọn một thanh để xem hàng số liệu tương ứng.", "Select a bar to view its result row."))}</p></div>`;
    const coords = rows.map((r, i) => ({ ...r, x: 65 + i * 550 / Math.max(1, rows.length - 1), y: r.value === null ? null : 230 - W.position(r.value, max, 185) }));
    let line = "", pen = false;
    for (const p of coords) { if (p.y === null) { pen = false; continue; } line += `${pen ? "L" : "M"}${p.x},${p.y} `; pen = true; }
    const area = type === "area" && coords.every((p) => p.y !== null) ? `<path d="${line} L615,230 L65,230 Z" fill="#234c9e" opacity=".08"/>` : "";
    return `<figure class="line-plot"><figcaption class="chart-unit">SGD · ${esc(editing ? t("Theo tháng · kết quả chạy thử", "Monthly · preview result") : t("Theo tháng; chọn điểm để xem số liệu", "Monthly; select a point to inspect values"))}</figcaption><svg viewBox="0 0 680 282" role="group" aria-label="${esc(nameOf(q))}"><title>${esc(nameOf(q))}</title>${[45, 107, 168, 230].map((y, i) => `<line x1="65" y1="${y}" x2="628" y2="${y}" stroke="#16150f" stroke-opacity=".12"/><text x="54" y="${y + 4}" text-anchor="end" class="axis-text">${i === 3 ? "0" : i === 0 ? W.money(max).split(".")[0] : ""}</text>`).join("")}${area}<path d="${line}" fill="none" stroke="#234c9e" stroke-width="2.5"/>${coords.map((p) => `<text x="${p.x}" y="260" text-anchor="middle" class="axis-text">${esc(p.label.slice(5) + "/" + p.label.slice(2, 4))}</text>${p.y === null ? "" : `<a ${pointHref(p.label)} aria-label="${esc(p.label)}: ${W.money(p.value)} SGD"><circle cx="${p.x}" cy="${p.y}" r="16" fill="transparent"/><circle cx="${p.x}" cy="${p.y}" r="4" fill="#fbf8f0" stroke="#234c9e" stroke-width="2"/><title>${esc(p.label)} · SGD ${W.money(p.value)}</title></a>`}`).join("")}</svg><p class="chart-caption">${esc(editing ? t("Chưa lưu câu hỏi. Bảng bên dưới là kết quả dùng vẽ.", "Question not saved yet. The table below supplies the plot.") : t("Điểm mở đúng hàng tổng hợp; không tự suy ra hóa đơn phía dưới.", "Points open their aggregate row; underlying invoices are not inferred."))}</p></figure>`;
  }
  function dashboardPage(id) {
    if (id === "new" || params().edit === "1") return dashboardEditor(id);
    const d = book().dashboards.find((r) => r.id === id);
    if (!d) return unavailable("reports");
    const revenueMode = d.tiles.some((q) => ["revenue", "segment"].includes(book().questions.find((item) => item.id === q)?.dataset));
    const revenue = W.filteredRevenue(data.revenue, filterValues()), grouped = W.group(revenue, "period", "revenue");
    const last = grouped.at(-1), first = grouped.at(0);
    const cardContext = context({ from: id });
    const toolbar = `<div class="toolbar"><span class="label">${esc(t("Hồ sơ", "Customer"))} · ${esc(tenant()?.name)}</span><div class="actions">${b("copy-link", t("Sao chép liên kết", "Copy link"))}${b("print", t("Bản in / PDF", "Print / PDF"))}${canAuthor() ? link("dashboard/" + id, t("Chỉnh bố cục", "Edit layout"), { ...context(), edit: "1" }, "plate") : ""}</div></div>`;
    // The sample KPI strip belongs to this declared question, not every arbitrary query.
    const revenueQuestion = book().questions.find((q) => q.id === "q-revenue");
    const showReadings = d.id === "d-performance" && d.tiles.includes("q-revenue") && revenueQuestion?.dataset === "revenue" && revenueQuestion.executable !== false;
    const readings = showReadings ? `<div class="report-readings"><a href="${esc(url("question/q-revenue", { ...cardContext, view: "data" }))}"><span class="label">${esc(t("Doanh thu trong khoảng", "Revenue in selected range"))}</span><strong>${W.money(W.sum(revenue.map((r) => r.revenue)))}</strong><small>SGD · ${esc(t("Từ kết quả đang lọc", "From the filtered results"))}</small></a><a href="${esc(url("question/q-revenue", { ...cardContext, view: "data", focus: last?.label }))}"><span class="label">${esc(t("Tháng cuối trong khoảng", "Last month in range"))}</span><strong>${W.money(last?.value ?? null)}</strong><small>SGD · ${esc(last?.label || "—")}</small></a><div><span class="label">${esc(t("Phạm vi kết quả", "Result coverage"))}</span><strong>${grouped.length} <em>${esc(t("tháng", "months"))}</em></strong><small>${esc(segmentName(filterValues().segment))} · ${esc(first?.label || "—")} → ${esc(last?.label || "—")}</small></div></div>` : "";
    return frame("reports", nameOf(d), descriptionOf(d), `${crumbs([["reports", t("Báo cáo", "Reports")], [null, nameOf(d)]])}${toolbar}${filters("dashboard/" + id, revenueMode ? "revenue" : "snapshot")}
      <div class="report-context"><span class="mono">${esc(revenueMode ? filterValues().period_from + " → " + filterValues().period_to : t("Tại 29/09/2026", "As of 29 Sep 2026"))} · ${esc(segmentName(filterValues().segment))}</span><span>${esc(t("Kết quả mẫu cố định · không phải dữ liệu trực tiếp", "Fixed sample results · not live data"))}</span></div>${readings}
      <div class="report-spread">${d.tiles.map((qid, i) => {
        const q = book().questions.find((r) => r.id === qid);
        if (!q) return `<section class="report-tile">${empty(t("Câu hỏi không còn tồn tại", "Question no longer exists"), t("Vị trí được giữ để người biên tập sửa liên kết.", "This slot stays visible so an author can repair the reference."))}</section>`;
        return `<section class="report-tile ${q.dataset === "invoices" || d.tiles.length === 1 || d.tiles.every((qid) => ["aging", "invoices"].includes(book().questions.find((item) => item.id === qid)?.dataset)) ? "wide" : ""}"><header><div><span class="label quiet">${String(i + 1).padStart(2, "0")} · ${esc(t("Câu hỏi đã lưu", "Saved question"))}</span><h2>${link("question/" + q.id, nameOf(q), cardContext)}</h2></div>${link("question/" + q.id, t("Xem lớn ↗", "Focus ↗"), { ...cardContext, view: "chart" }, "text-link")}</header>${["aging", "invoices"].includes(q.dataset) ? `<p class="chart-unit">${esc(t("Ảnh chụp 29/09/2026 · lọc theo nhóm, không theo khoảng tháng", "Snapshot 29 Sep 2026 · segment filter only, not the month range"))}</p>` : ""}${plot(q, questionResult(q), q.chart, id)}<footer><span class="mono quiet">${esc(q.model)}</span>${link("question/" + q.id, t("Xem số liệu →", "View data →"), { ...cardContext, view: "data" })}</footer></section>`;
      }).join("")}</div>
      ${info(esc(t("Bộ lọc được giữ khi mở câu hỏi rồi quay lại. Thời điểm chạy truy vấn và độ mới của nguồn là hai thông tin khác nhau; bản mẫu không gán nhãn “đã cập nhật” cho dữ liệu thật.", "Filters survive the trip into a question and back. Query execution time and source freshness are different facts; the review makes no live freshness claim.")))}`);
  }
  function questionPage(id) {
    if (id === "new" || params().edit === "1") return questionEditor(id);
    const q = book().questions.find((r) => r.id === id);
    if (!q) return unavailable("reports");
    const view = params().view || "chart", answer = questionResult(q), origin = book().dashboards.find((d) => d.id === params().from);
    const validViews = [["chart", t("Trình bày", "Visualization")], ["data", t("Số liệu", "Data")], ...(canAuthor() ? [["definition", t("Định nghĩa", "Definition")]] : [])];
    const source = `${fact(t("Bảng mô hình", "Model table"), role() === "viewer" ? esc(q.model) : link("model/" + q.model, q.model))}${fact(t("Cách tạo", "Question type"), esc(q.kind === "sql" ? "SQL" : t("Trực quan", "Visual")))}${fact(t("Người sửa", "Edited by"), esc(q.author))}${fact(t("Sửa định nghĩa", "Definition edited"), stamp(q.updated))}`;
    return frame("reports", nameOf(q), descriptionOf(q), `${crumbs([["reports", t("Báo cáo", "Reports")], [null, nameOf(q)]])}${origin ? `<p>${link("dashboard/" + origin.id, "← " + nameOf(origin), context({ from: undefined }), "text-link back-context")}</p>` : ""}<div class="toolbar"><span class="label">${esc(t("Câu hỏi đã lưu", "Saved question"))}</span><div class="actions">${b("csv", t("Xuất số liệu CSV", "Export data CSV"), id, false, answer.state !== "ok")}${b("copy-link", t("Sao chép liên kết", "Copy link"))}${canAuthor() ? link("question/" + id, t("Chỉnh câu hỏi", "Edit question"), { ...context(), edit: "1" }, "plate") : ""}</div></div>${filters("question/" + id, ["revenue", "segment"].includes(q.dataset) ? "revenue" : "snapshot")}${tabs("question/" + id, validViews, view, context())}
      ${view === "definition" && canAuthor() ? `<div class="fact-grid">${source}</div><div class="source-detail"><h2>${esc(t("Định nghĩa đang lưu", "Saved definition"))}</h2><pre class="raw">${esc(q.sql)}</pre><p class="prose">${esc(t("Truy vấn báo cáo chỉ đọc bảng analytics được cấp quyền. Quan hệ với model trong mẫu này được khai báo; SQL tùy ý không tự có lineage.", "Report queries read permitted analytics tables. The model reference here is declared; arbitrary SQL does not automatically imply lineage."))}</p>${link("models", t("Mở dòng dữ liệu của mô hình →", "Open model lineage →"), { view: "graph", node: q.model })}</div>` : `<section class="question-canvas"><div class="report-context"><span>${esc(t("Cùng một tập kết quả cho biểu đồ và bảng", "The chart and table use the same result"))}</span><span class="mono">${answer.state === "ok" ? answer.rows.length : "—"} ${esc(t("hàng kết quả mẫu", "sample result rows"))}</span></div>${view === "data" && answer.state === "ok" ? dataTable(q, answer) : plot(q, answer, q.chart, origin?.id)}${params().focus ? info(esc(t("Đang xem hàng tổng hợp đã chọn: ", "Inspecting selected aggregate row: ") + params().focus)) : ""}</section>`}
      ${info(esc(t("Xuất CSV chỉ xuất kết quả đang lọc, không suy ra toàn bộ dữ liệu nguồn. Số thiếu giữ trống; giá trị tiền không đi qua số thực để hiển thị.", "CSV exports only the current filtered result, not the entire source. Missing amounts stay empty; readable money values are not converted to floats.")))}`);
  }
  const supported = ["table", "number", "bar", "line", "area"];
  const chartNames = () => ({ table: t("Bảng · đọc chính xác", "Table · exact values"), number: t("Chỉ số · một tổng", "Number · one total"), bar: t("Thanh · so sánh nhóm", "Bar · compare groups"), line: t("Đường · xu hướng thời gian", "Line · time trend"), area: t("Vùng · quy mô theo thời gian", "Area · volume over time") });
  function questionEditor(id) {
    if (!canAuthor()) return frame("reports", t("Câu hỏi", "Question"), "", empty(t("Quyền chỉ xem", "Read-only access"), t("Bạn có thể đọc câu hỏi đã lưu. Biên tập cần vai trò thành viên hoặc quản trị.", "You can read saved questions. Authoring requires member or administrator access.")));
    const saved = book().questions.find((r) => r.id === id);
    if (id !== "new" && !saved) return unavailable("reports");
    const base = saved || { id: "new", name: t("Câu hỏi mới", "New question"), nameEn: "", description: "", descriptionEn: "", model: "revenue_monthly", dataset: "revenue", kind: "visual", chart: "line", sql: "select * from revenue_monthly;" };
    const d = draft("question", id, base), answer = results.get(key("question", id));
    const models = ui.db().models.filter((m) => m.status === "success" || m.lastSuccess);
    if (!models.length) return frame("reports", t("Tạo câu hỏi", "Create question"), "", empty(t("Chưa có bảng mô hình để hỏi", "No model table is available yet"), t("Dựng một mô hình trước khi tạo truy vấn báo cáo.", "Build a model before authoring a report query."), link("models", t("Xem mô hình", "Open models"), {}, "plate")));
    return frame("reports", id === "new" ? t("Đặt một câu hỏi", "Ask a question") : t("Biên tập câu hỏi", "Edit question"), t("Chọn dữ liệu, xem thử kết quả rồi mới lưu cách trình bày.", "Choose data, preview the result, then save its presentation."), `${crumbs([["reports", t("Báo cáo", "Reports")], [null, nameOf(d)]])}<form data-form="ws-question-save" data-id="${esc(id)}"><div class="editor-head">${field(t("Tên câu hỏi", "Question name"), input("name", d.name, "", 'required maxlength="120"'))}<div class="actions">${b("question-run", t("Chạy thử mẫu", "Preview sample"), id)}${submit(t("Lưu câu hỏi mẫu", "Save sample question"))}${b("discard-question", t("Bỏ thay đổi", "Discard"), id)}</div></div><div class="question-workbench"><section class="query-leaf"><h2>01 · ${esc(t("Dữ liệu & định nghĩa", "Data & definition"))}</h2>${field(t("Bộ dữ liệu mẫu", "Sample dataset"), select("datasetKey", [["revenue", t("Doanh thu theo tháng", "Monthly revenue")], ["segment", t("Doanh thu theo nhóm", "Revenue by segment")], ["aging", t("Công nợ theo tuổi", "Receivables by age")], ["invoices", t("Sổ công nợ", "Invoice ledger")], ["support", t("Lý do hoàn tiền · chưa dựng", "Refund reasons · unbuilt")]], d.dataset))}${field(t("Chế độ", "Mode"), select("kind", [["visual", t("Trực quan", "Visual")], ["sql", "SQL"]], d.kind))}<p class="prose quiet">${esc(t("Trực quan: chọn bộ dữ liệu mẫu đã định nghĩa sẵn. SQL: chỉ chạy được câu mẫu bên dưới; nội dung khác được giữ nhưng không giả lập kết quả.", "Visual mode selects a predefined sample dataset. SQL mode runs only the sample below; other SQL is retained without inventing results."))}</p>${field("SQL", `<textarea class="editor" name="sql" rows="7" spellcheck="false">${esc(d.sql)}</textarea>`)}${b("sample-sql", t("Nạp SQL mẫu cho bộ dữ liệu", "Load dataset sample SQL"), id)}</section><section class="query-leaf"><h2>02 · ${esc(t("Cách trình bày", "Presentation"))}</h2>${field(t("Mục đích đọc", "Reading purpose"), select("chart", supported.map((c) => [c, chartNames()[c]]), d.chart))}<p class="prose">${esc(t("Đường cho thời gian; thanh cho nhóm; bảng cho từng chữ số. Chỉ số chỉ dùng khi tổng có ý nghĩa.", "Lines for time; bars for groups; tables for exact digits. A number is useful only when the total is meaningful."))}</p><details class="chart-catalog"><summary>${esc(t("Các kiểu khác trong hệ hiện tại", "Other types in the existing system"))}</summary><p class="prose">${esc(t("Pie, doughnut, scatter, bubble, radar, combo, funnel, gauge, progress, pivot, map. Giữ đủ 16 kiểu khi tích hợp; bản mẫu thao tác 5 kiểu thông dụng. Không chọn bản đồ nếu thiếu tọa độ, hoặc gauge nếu chưa có mục tiêu.", "Pie, doughnut, scatter, bubble, radar, combo, funnel, gauge, progress, pivot, map. Retain all 16 at integration; this review demonstrates 5 common types. Maps need locations; gauges need an explicit target."))}</p></details><h3>${esc(t("Kết quả chạy thử", "Preview result"))}</h3>${answer ? plot(d, answer, d.chart) + (answer.state === "ok" && d.chart !== "table" ? `<details class="permissions-details"><summary>${esc(t("Xem bảng kết quả chạy thử", "View preview result table"))}</summary>${dataTable(d, answer)}</details>` : "") : empty(t("Chưa chạy thử", "Not previewed yet"), t("Chạy thử để xem dữ liệu phù hợp với cách trình bày nào.", "Preview to see which presentation fits the data."))}</section></div></form><p class="prose quiet">${esc(t("Lưu định nghĩa không chứng minh truy vấn chạy thành công. Bản nháp vẫn còn khi chuyển trang rồi quay lại trong tab này.", "Saving a definition does not prove that a query succeeds. The draft survives navigating away and back in this tab."))}</p>${saved ? `<div class="detail-band">${b("delete-question", t("Xóa câu hỏi…", "Delete question…"), id)}${params().confirm === "question" ? confirmPanel(t("Xóa câu hỏi đã lưu?", "Delete saved question?"), t("Dashboard đang dùng câu hỏi này sẽ giữ một ô báo thiếu câu hỏi. Không xóa mô hình hoặc dữ liệu.", "Dashboards keep a missing-question slot. Models and data are not deleted."), "confirm-delete-question", id) : ""}</div>` : ""}`);
  }
  function dashboardEditor(id) {
    if (!canAuthor()) return frame("reports", t("Bảng điều hành", "Dashboard"), "", empty(t("Quyền chỉ xem", "Read-only access"), t("Chỉ thành viên và quản trị viên được biên tập.", "Members and administrators can author dashboards.")));
    const saved = book().dashboards.find((r) => r.id === id);
    if (id !== "new" && !saved) return unavailable("reports");
    const d = draft("dashboard", id, saved || { id: "new", name: t("Bảng điều hành mới", "New dashboard"), nameEn: "", description: "", descriptionEn: "", tiles: [] });
    return frame("reports", t("Biên tập bảng điều hành", "Edit dashboard"), t("Đặt câu hỏi quan trọng trước. Các ô là câu hỏi đã lưu, có thể sắp xếp bằng bàn phím.", "Place the most important question first. Tiles are saved questions and can be arranged with the keyboard."), `${crumbs([["reports", t("Báo cáo", "Reports")], [null, nameOf(d)]])}<form data-form="ws-dashboard-save" data-id="${esc(id)}"><div class="editor-head">${field(t("Tên bảng điều hành", "Dashboard name"), input("name", d.name, "", 'required maxlength="120"'))}<div class="actions">${submit(t("Lưu bố cục mẫu", "Save sample layout"))}${b("discard-dashboard", t("Bỏ thay đổi", "Discard"), id)}</div></div>${field(t("Câu hỏi chính của báo cáo", "What should this report answer?"), input("description", d.description, t("Ví dụ: nhóm nào đóng góp doanh thu?", "Example: which segments contribute revenue?")))}<section class="dashboard-layout"><h2>${esc(t("Thứ tự đọc", "Reading order"))}</h2>${d.tiles.map((qid, i) => `<div class="layout-row"><span class="mono">${String(i + 1).padStart(2, "0")}</span><strong>${esc(nameOf(book().questions.find((q) => q.id === qid) || { name: t("Câu hỏi đã xóa", "Deleted question") }))}</strong><div class="actions">${b("tile-up", t("Lên ↑", "Up ↑"), `${id}:${i}`, false, i === 0)}${b("tile-down", t("Xuống ↓", "Down ↓"), `${id}:${i}`, false, i === d.tiles.length - 1)}${b("tile-remove", t("Bỏ khỏi bố cục", "Remove tile"), `${id}:${i}`)}</div></div>`).join("") || info(esc(t("Chọn ít nhất một câu hỏi bên dưới.", "Choose at least one question below.")))}</section><section class="query-leaf"><h2>${esc(t("Thêm câu hỏi đã lưu", "Add saved questions"))}</h2>${book().questions.filter((q) => !d.tiles.includes(q.id)).map((q) => `<div class="layout-row"><span>${esc(nameOf(q))}</span>${b("tile-add", t("Thêm +", "Add +"), `${id}:${q.id}`)}</div>`).join("") || info(esc(t("Không còn câu hỏi để thêm.", "No more questions to add.")))}</section></form>${info(esc(t("Bản mẫu minh họa thứ tự và thêm/bỏ ô. Khi tích hợp giữ grid 12 cột, điều khiển kích thước và DashboardFilterEditor sẵn có.", "This review demonstrates order and adding/removing tiles. Integration retains the existing 12-column grid, sizing controls and DashboardFilterEditor.")))}${saved ? `<div class="detail-band">${b("delete-dashboard", t("Xóa bảng điều hành…", "Delete dashboard…"), id)}${params().confirm === "dashboard" ? confirmPanel(t("Xóa bảng điều hành?", "Delete dashboard?"), t("Chỉ xóa bố cục; các câu hỏi đã lưu và dữ liệu vẫn còn.", "Only the layout is removed. Saved questions and data remain."), "confirm-delete-dashboard", id) : ""}</div>` : ""}`);
  }
  function confirmPanel(title, text, act, id, label) {
    return `<section class="source-detail" role="region" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p class="prose">${esc(text)}</p><div class="actions">${b(act, label || t("Xác nhận trong bản mẫu", "Confirm in prototype"), id, true)}${link(current().path, t("Hủy", "Cancel"), { ...params(), confirm: undefined }, "plate")}</div></section>`;
  }
  function rights() {
    const rows = [
      [t("Xem báo cáo đã lưu", "Read saved reports"), "●", "●", "●"],
      [t("Tạo / sửa câu hỏi & dashboard", "Author questions & dashboards"), "—", "●", "●"],
      [t("SQL báo cáo (analytics, chỉ đọc)", "Report SQL (analytics, read-only)"), "—", "●", "●"],
      [t("Cấp quyền nguồn / xem payload thô", "Authorize sources / read raw payload"), "—", "—", "●"],
      [t("Mời / đổi quyền / gỡ thành viên", "Invite / change roles / remove members"), "—", "—", "●"],
      [t("Tạo khách hàng mới", "Create another customer"), "—", "—", t("Cần quyền nền tảng", "Platform authority required")],
    ];
    return `<p class="prose">${esc(t("Quyền áp dụng trong khách hàng hiện tại. ● Được phép · — Không được phép.", "Permissions apply within this customer. ● Allowed · — Not allowed."))}</p>${table([t("Khả năng", "Capability"), roleName("viewer"), roleName("member"), roleName("admin")], rows.map((r) => r.map(esc)), t("So sánh vai trò", "Role comparison"))}`;
  }
  function peoplePage(id) {
    if (id) return personPage(id);
    const view = params().view || "members", query = params().q || "";
    const list = (view === "invites" ? book().invitations : book().people).filter((r) => W.normalize(r.email + " " + (r.name || "")).includes(W.normalize(query)));
    return frame("people", t("Người dùng & quyền truy cập", "People & access"), t("Ai được đọc hồ sơ này, ai được đặt câu hỏi và ai được thay đổi quyền truy cập.", "Who can read this book, who can ask questions and who can change access."), `<div class="workspace-current"><p><span class="label">${esc(t("Phạm vi đang quản lý", "Managing access for"))}</span><strong>${esc(tenant()?.name || "—")}</strong><span class="mono">${esc(tenantId())}</span></p>${admin() ? link("invite", t("Mời người dùng", "Invite a person"), {}, "plate plate-primary") : `<span class="label">${esc(t("Bạn có quyền", "Your role"))}: ${esc(roleName(role()))}</span>`}</div>${tabs("people", [["members", t("Thành viên", "Members") + ` · ${book().people.length}`], ["invites", t("Lời mời đang chờ", "Open invitations") + ` · ${book().invitations.length}`], ["roles", t("So sánh quyền", "Compare roles")]], view)}
      ${view === "roles" ? rights() : `<form class="ws-search" data-form="ws-people-filter">${field(t("Tìm tên hoặc email", "Find name or email"), input("q", query))}<input type="hidden" name="view" value="${esc(view)}">${submit(t("Tìm", "Search"))}${query ? link("people", t("Xóa lọc", "Clear"), { view }) : ""}</form>${list.length ? `<div class="roster">${list.map((r) => `<article class="roster-row"><span class="person-monogram" aria-hidden="true">${esc((r.name || r.email).slice(0, 1))}</span><div><h2>${view === "members" ? link("people/" + r.id, r.name || r.email) : esc(r.email)}</h2><span class="mono">${esc(view === "members" ? r.email : t("Hết hạn: ", "Expires: "))}${view === "invites" ? stamp(r.expires) : ""}</span>${r.email === "operator@example.test" ? `<span class="you-label">${esc(t("Bạn", "You"))}</span>` : ""}${view === "members" && r.role === "admin" && book().people.filter((x) => x.role === "admin").length === 1 ? `<span class="you-label">${esc(t("Quản trị viên cuối cùng", "Last administrator"))}</span>` : ""}</div><div>${badge(roleName(r.role), view === "invites" ? "warning" : "")}<p class="quiet">${esc(view === "invites" ? t("Chưa trở thành thành viên", "Not a member yet") : t("Đã có quyền truy cập", "Has access"))}</p></div><div>${view === "members" ? link("people/" + r.id, t("Chi tiết →", "Details →"), {}, "plate") : admin() ? b("revoke-invite", t("Thu hồi lời mời…", "Withdraw invitation…"), r.id) : ""}</div></article>${params().confirm === r.id && view === "invites" && admin() ? confirmPanel(t("Thu hồi lời mời?", "Withdraw this invitation?"), r.email + " · " + t("Địa chỉ này sẽ không thể nhận quyền từ lời mời đang chờ.", "This address will no longer gain access through this pending invitation."), "confirm-revoke-invite", r.id, t("Thu hồi ", "Withdraw ") + r.email) : ""}`).join("")}</div>` : empty(query ? t("Không tìm thấy địa chỉ phù hợp", "No matching addresses") : view === "invites" ? t("Không có lời mời đang chờ", "No open invitations") : t("Chưa có thành viên", "No members"), t("Lời mời và thành viên là hai trạng thái riêng biệt.", "An invitation and a membership are different states."))}`}`);
  }
  function personPage(id) {
    const p = book().people.find((r) => r.id === id);
    if (!p) return unavailable("people");
    const d = draft("person", id, { role: p.role });
    const lastAdmin = p.role === "admin" && book().people.filter((r) => r.role === "admin").length === 1;
    return frame("people", p.name, p.email, `${crumbs([["people", t("Người dùng", "People")], [null, p.email]])}<div class="fact-grid">${fact(t("Khách hàng", "Customer"), esc(tenant()?.name))}${fact(t("Quyền hiện tại", "Current role"), esc(roleName(p.role)))}${fact(t("Email", "Email"), esc(p.email))}${fact(t("Phạm vi", "Scope"), esc(t("Chỉ hồ sơ này", "This book only")))}</div>${lastAdmin ? info(esc(t("Quản trị viên cuối cùng. Không có lựa chọn hạ quyền hay gỡ; hãy cấp quyền quản trị cho một thành viên khác trước.", "The last administrator. A lower role and removal are not offered; make another member admin first."))) : ""}
      ${admin() && !lastAdmin ? `<form class="ws-form" data-form="ws-role-save" data-id="${esc(id)}">${field(t("Vai trò", "Role"), select("role", roleOptions(), p.role))}<p class="quiet">${esc(t("Chọn là lưu, như danh sách thành viên hiện nay.", "Choosing a role saves it, as the roster does today."))}</p></form>` : ""}<details class="permissions-details"><summary>${esc(t("Xem quyền của từng vai trò", "View role permissions"))}</summary>${rights()}</details>${admin() && !lastAdmin ? `<section class="detail-band">${b("remove-member", t("Gỡ khỏi khách hàng…", "Remove from customer…"), id)}${params().confirm === id ? confirmPanel(t("Gỡ quyền truy cập hồ sơ?", "Remove access to this book?"), t("Không xóa tài khoản toàn hệ thống hoặc dữ liệu khách hàng. Chỉ kết thúc tư cách thành viên tại hồ sơ này.", "This does not delete the platform account or customer data. Only membership in this book ends."), "confirm-remove-member", id) : ""}</section>` : ""}`);
  }
  function invitePage() {
    const d = draft("invite", "new", { email: "", role: "viewer" });
    return frame("people", t("Mời người dùng", "Invite a person"), t("Cấp đúng mức quyền cho đúng khách hàng. Lời mời chưa phải quyền đã được nhận.", "Grant the right role in the right customer. An invitation is not an accepted membership."), `${crumbs([["people", t("Người dùng", "People")], [null, t("Lời mời", "Invitation")]])}${!admin() ? empty(t("Cần quyền quản trị", "Administrator required"), t("Chỉ quản trị viên được mời người dùng.", "Only administrators can invite people.")) : `<form class="ws-form" data-form="ws-invite">${field(t("Email giả lập", "Synthetic email"), input("email", d.email, "person@example.test", 'type="email" required'))}${field(t("Vai trò trong khách hàng này", "Role in this customer"), select("role", roleOptions(), d.role))}<p class="prose">${esc(t("Khách hàng nhận quyền: ", "Access is granted within: "))}<strong>${esc(tenant()?.name)}</strong> · <span class="mono">${esc(tenantId())}</span></p>${info(esc(t("Chỉ dùng email @example.test trong bản mẫu. Không có email thật được gửi. Tạo lời mời và gửi email là hai kết quả riêng.", "Use only @example.test in this review. No email is sent. Creating an invitation and delivering an email are separate results.")))}<div class="actions">${submit(t("Tạo lời mời mẫu", "Create sample invitation"))}${link("people", t("Quay lại", "Back"), {}, "plate")}</div></form><section class="detail-band"><h2>${esc(t("Mỗi vai trò được làm gì", "What each role may do"))}</h2>${rights()}</section>`}`);
  }
  function unavailable(section) { return frame(section, t("Không tìm thấy", "Not found"), "", empty(t("Mục này không có trong hồ sơ đang mở", "This item is not in the open book"), t("Quay lại danh sách để chọn một mục được cấp quyền.", "Return to the list to choose an accessible item."), link(section, t("Về danh sách", "Back to list"), {}, "plate"))); }
  function capture(form) {
    if (!form) return;
    const kind = { "ws-question-save": "question", "ws-dashboard-save": "dashboard", "ws-rename": "tenant", "ws-customer-create": "tenant", "ws-role-review": "person", "ws-invite": "invite" }[form.dataset.form];
    if (!kind) return;
    const d = drafts.get(key(kind, form.dataset.id || "new"));
    if (d) {
      const next = Object.fromEntries(new FormData(form));
      // A control named 'dataset' shadows HTMLFormElement.dataset.
      if (kind === "question") { next.dataset = next.datasetKey; delete next.datasetKey; }
      if (kind === "question" && ["dataset", "kind", "sql", "chart"].some((field) => next[field] !== d[field])) results.delete(key(kind, form.dataset.id || "new"));
      Object.assign(d, next);
    }
  }
  async function submitForm(form, values) {
    capture(form);
    const id = form.dataset.id;
    switch (form.dataset.form) {
      case "ws-customer-filter": go("customers", values); return;
      case "ws-report-search": go("reports", values); return;
      case "ws-people-filter": go("people", values); return;
      case "ws-report-filter":
        if (values.period_from && values.period_to && values.period_from > values.period_to) { ui.error(t("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.", "Start date must not be after end date.")); render(); return; }
        if (values.period_from) values.period_from += "-01";
        if (values.period_to) {
          const [year, month] = values.period_to.split("-").map(Number);
          values.period_to += "-" + new Date(Date.UTC(year, month, 0)).getUTCDate();
        }
        go(id, { ...context(), ...values, view: params().view }); return;
      case "ws-rename": await write(() => { tenant().name = values.name.trim() || tenant().id; drafts.delete(key("tenant", id)); }, t("Đã lưu tên trong bản mẫu.", "Name saved in prototype."), "customer/" + id); return;
      case "ws-customer-create":
        await write(() => {
          if (!/^CASE-\d{4,}$/.test(values.id) || data.tenants.some((r) => r.id === values.id)) throw new Error(t("Mã CASE không hợp lệ hoặc đã tồn tại.", "CASE identifier is invalid or already exists."));
          data.tenants.push({ id: values.id, name: values.name.trim() || values.id, role: "admin", created: new Date().toISOString() }); drafts.delete(key("tenant", "new"));
        }, t("Đã tạo khách hàng trong bản mẫu.", "Customer created in prototype."), "customers", platform); return;
      case "ws-invite":
        await write(() => {
          const email = values.email.trim().toLowerCase();
          if (!/^[^@\s]+@example\.test$/.test(email)) throw new Error(t("Dùng địa chỉ mẫu @example.test.", "Use a synthetic @example.test address."));
          if (book().people.some((p) => p.email === email) || book().invitations.some((p) => p.email === email)) throw new Error(t("Địa chỉ đã có quyền hoặc đang có lời mời.", "This address already has access or a pending invitation."));
          book().invitations.push({ id: "i-" + Date.now(), email, role: values.role, expires: "2026-10-06T08:00:00Z" }); drafts.delete(key("invite", "new"));
        }, t("Đã tạo lời mời mẫu. Không gửi email; đây không phải thành viên đã nhận quyền.", "Sample invitation created. No email sent; membership has not been accepted."), "people");
        if (current().path === "people") go("people", { view: "invites" }); return;
      case "ws-question-save":
      case "ws-dashboard-save": {
        const kind = form.dataset.form === "ws-question-save" ? "question" : "dashboard";
        const d = drafts.get(key(kind, id));
        const list = kind === "question" ? book().questions : book().dashboards;
        const savedId = id === "new" ? (kind === "question" ? "q-" : "d-") + Date.now() : id;
        await write(() => {
          if (!d.name.trim()) throw new Error(t("Cần tên để lưu.", "A name is required."));
          if (kind === "dashboard" && !d.tiles.length) throw new Error(t("Chọn ít nhất một câu hỏi.", "Choose at least one question."));
          if (kind === "question") validateChart(d);
          const value = { ...W.clone(d), id: savedId, nameEn: d.name, descriptionEn: d.description, updated: new Date().toISOString(), author: "operator@example.test" };
          if (kind === "question") {
            value.model = ["revenue", "segment"].includes(d.dataset) ? "revenue_monthly" : d.dataset === "support" ? "refund_reasons" : "ar_open_items";
            value.executable = d.kind === "visual" || d.sql.trim().toLowerCase() === `select * from ${value.model};`;
          }
          const index = list.findIndex((r) => r.id === savedId);
          if (index < 0) list.push(value); else list[index] = value;
          drafts.delete(key(kind, id));
        }, t("Đã lưu định nghĩa trong bản mẫu.", "Definition saved in prototype."), kind + "/" + savedId, canAuthor);
        return;
      }
    }
  }
  function validateChart(d) {
    if (d.dataset === "invoices" && d.chart !== "table") throw new Error(t("Sổ hóa đơn cần dạng bảng để giữ từng bản ghi; hãy chọn Bảng.", "The invoice ledger needs Table to preserve individual records."));
    if (["line", "area"].includes(d.chart) && d.dataset !== "revenue") throw new Error(t("Đường/vùng cần trục thời gian. Chọn bộ Doanh thu theo tháng hoặc đổi sang Thanh.", "Line/area needs time. Select Monthly revenue or use Bar."));
  }
  let pendingRole = null;
  async function saveRole(id, role) { pendingRole = role; try { await action("ws-role-save", id); } finally { pendingRole = null; } }
  async function action(name, id) {
    if (!name.startsWith("ws-")) return false;
    const act = name.slice(3);
    if (act === "print") { window.print(); return true; }
    if (act === "copy-link") {
      try { await navigator.clipboard.writeText(location.href); ui.message(t("Đã chép liên kết kèm bộ lọc. Người nhận vẫn cần quyền xem dữ liệu.", "Copied link with filters. Recipients still need permission.")); }
      catch { ui.message(t("Trình duyệt không cho chép tự động. Chép địa chỉ trên thanh URL; bộ lọc đã nằm trong đó.", "Clipboard unavailable. Copy the address bar URL; it contains the filters.")); }
      render(); return true;
    }
    if (act === "csv") {
      const q = book().questions.find((r) => r.id === id), answer = questionResult(q);
      const rows = q.dataset === "invoices" ? answer.rows.map((r) => [r.id, r.customer, r.due, r.amount, r.currency]) : answer.rows.map((r) => [r.label, r.value, "SGD"]);
      const blob = new Blob(["\ufeff" + W.safeCsv([answer.columns, ...rows])], { type: "text/csv;charset=utf-8" });
      const object = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = object; anchor.download = id + "-sample.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(object), 1000);
      ui.message(t("Đã xuất các hàng kết quả mẫu đang lọc.", "Exported the filtered sample rows.")); render(); return true;
    }
    if (act.startsWith("discard-")) {
      const kind = act.slice(8); drafts.delete(key(kind, id)); results.delete(key(kind, id));
      go(kind === "tenant" ? "customer/" + id : id === "new" ? "reports" : kind + "/" + id); return true;
    }
    if (act === "question-run" || act === "sample-sql") {
      if (!canAuthor()) return true;
      ui.error(""); ui.message("");
      const form = document.querySelector('[data-form="ws-question-save"]'); capture(form);
      const d = drafts.get(key("question", id));
      const sample = ["revenue", "segment"].includes(d.dataset) ? "select * from revenue_monthly;" : d.dataset === "support" ? "select * from refund_reasons;" : "select * from ar_open_items;";
      if (act === "sample-sql") { d.sql = sample; render(); return true; }
      try {
        validateChart(d);
        if (d.kind === "sql" && d.sql.trim().toLowerCase() !== sample) throw new Error(t("Bản mẫu không thực thi SQL tùy ý. Bấm Nạp SQL mẫu để thử luồng; nội dung của bạn vẫn được giữ.", "This review does not execute arbitrary SQL. Load the sample SQL to test the flow; your text is retained."));
        results.set(key("question", id), questionResult({ ...d, executable: true })); ui.message(t("Đang xem kết quả mẫu, chưa lưu định nghĩa.", "Showing sample results; definition has not been saved."));
      } catch (cause) { ui.error(cause.message); results.delete(key("question", id)); }
      render(); return true;
    }
    if (act.startsWith("tile-")) {
      if (!canAuthor()) return true;
      capture(document.querySelector('[data-form="ws-dashboard-save"]'));
      const [dashboardId, target] = id.split(":"), d = drafts.get(key("dashboard", dashboardId)), at = Number(target);
      if (act === "tile-add" && !d.tiles.includes(target)) d.tiles.push(target);
      if (act === "tile-remove") d.tiles.splice(at, 1);
      if (act === "tile-up" && at > 0) [d.tiles[at - 1], d.tiles[at]] = [d.tiles[at], d.tiles[at - 1]];
      if (act === "tile-down" && at < d.tiles.length - 1) [d.tiles[at + 1], d.tiles[at]] = [d.tiles[at], d.tiles[at + 1]];
      render(); return true;
    }
    if (act === "delete-question" || act === "delete-dashboard") { go(current().path, { ...params(), confirm: act.slice(7), edit: "1" }); return true; }
    if (act === "confirm-delete-question" || act === "confirm-delete-dashboard") {
      const kind = act.slice(15), fieldName = kind === "question" ? "questions" : "dashboards";
      await write(() => { book()[fieldName] = book()[fieldName].filter((r) => r.id !== id); drafts.delete(key(kind, id)); }, t("Đã xóa định nghĩa mẫu.", "Sample definition deleted."), "reports", canAuthor); return true;
    }
    if (act === "revoke-invite" || act === "remove-member") { go(current().path, { ...params(), confirm: id }); return true; }
    if (act === "role-save" || act === "confirm-remove-member") {
      const p = book().people.find((r) => r.id === id), nextRole = act === "role-save" ? pendingRole : null;
      let applied = false;
      await write(() => {
        if (W.permittedMembershipChange(book().people, p?.email, nextRole)) throw new Error(t("Không thể hạ quyền hoặc gỡ quản trị viên cuối cùng.", "The last administrator cannot be demoted or removed."));
        if (nextRole) p.role = nextRole; else book().people = book().people.filter((r) => r.id !== id);
        drafts.delete(key("person", id));
        if (p.email === "operator@example.test") {
          if (nextRole) tenant().role = nextRole;
          else data.tenants = data.tenants.filter((row) => row.id !== tenantId());
        }
        applied = true;
      }, t("Đã cập nhật quyền trong bản mẫu.", "Access updated in prototype."), "people");
      if (applied && p.email === "operator@example.test") {
        if (nextRole) go("people", { role: nextRole });
        else go("customers", { tenant: data.tenants[0]?.id || "unassigned", role: data.tenants[0]?.role || "viewer" });
      }
      return true;
    }
    if (act === "confirm-revoke-invite") {
      await write(() => { book().invitations = book().invitations.filter((r) => r.id !== id); }, t("Đã thu hồi lời mời mẫu.", "Sample invitation revoked."), "people"); return true;
    }
    return true;
  }
  function afterRender() {
    document.querySelectorAll(".layout-row").forEach((row) => {
      const title = row.querySelector("strong")?.textContent || row.querySelector("span")?.textContent;
      row.querySelectorAll("button").forEach((control) => control.setAttribute("aria-label", control.textContent + " · " + title));
    });
    const header = document.querySelector(".tenant");
    if (header) header.innerHTML = `<strong>${esc(tenant()?.name || t("Không rõ hồ sơ", "Unknown book"))}</strong>${link("customers", tenantId(), {}, "mono tenant-switch")}`;
    const demo = document.querySelector(".demo-note");
    if (demo) demo.textContent = t("BẢN DUYỆT R5 · Dữ liệu giả lập · Không kết nối hệ thống thật", "REVIEW R5 · Synthetic data · No production connection");
    const footer = document.querySelector(".footer > span");
    if (footer) footer.textContent = t("Nền đối chiếu: v1.53.0 (116a41e) · Prototype r5, không phải phiên bản phát hành", "Reference UI: v1.53.0 (116a41e) · Prototype r5, not a release");
    const tools = document.querySelector(".tools-grid");
    if (tools) tools.insertAdjacentHTML("beforeend", `<div>${link(current().path, platform() ? t("Tắt quyền nền tảng mẫu", "Disable sample platform authority") : t("Thử quyền nền tảng", "Test platform authority"), { ...params(), platform: platform() ? undefined : "1" }, "plate")}</div>`);
    if (current().path.startsWith("model/") && canAuthor()) {
      const name = current().path.split("/")[1];
      const q = book().questions.find((r) => r.model === name);
      if (q) document.querySelector("#content .actions")?.insertAdjacentHTML("beforeend", link("question/" + q.id, t("Xem câu hỏi báo cáo →", "Open report question →"), {}, "plate"));
    }
  }
  function hasUnsaved() {
    for (const [k, value] of drafts) {
      const [tid, kind, id] = k.split(":");
      const tenantBook = books.get(tid);
      const saved = kind === "question" ? tenantBook?.questions.find((r) => r.id === id) : kind === "dashboard" ? tenantBook?.dashboards.find((r) => r.id === id) : null;
      if (saved && JSON.stringify(saved) !== JSON.stringify(value)) return true;
      if (kind === "invite" && value.email) return true;
      if (kind === "tenant" && id === "new" && (value.id || value.name)) return true;
      if (kind === "tenant" && id !== "new" && value.name !== data.tenants.find((r) => r.id === id)?.name) return true;
      if (kind === "person" && value.role !== tenantBook?.people.find((r) => r.id === id)?.role) return true;
      if ((kind === "question" || kind === "dashboard") && id === "new") return true;
    }
    return false;
  }
  function changed(event) {
    const form = event.target.closest("form");
    capture(form);
    if (form?.dataset.form === "ws-role-save" && event.target.name === "role") { saveRole(form.dataset.id, event.target.value); return; }
    if (["ws-question-save"].includes(form?.dataset.form) && event.target.tagName === "SELECT") {
      const name = event.target.name;
      render();
      document.querySelector(`select[name="${name}"]`)?.focus();
    }
  }
  return { pages: (id) => ({ customers: customersPage, customer: () => customerPage(id), "customer-new": newCustomerPage, reports: reportsPage, dashboard: () => dashboardPage(id), question: () => questionPage(id), people: () => peoplePage(id), invite: invitePage }), action, capture, submitForm, afterRender, hasUnsaved, changed, clearDrafts: () => drafts.clear() };
};
