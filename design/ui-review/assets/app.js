/* Offline interaction harness. Reimplement approved changes in the existing React app. */
(function () {
  "use strict";
  const D = window.ReviewDomain;
  let db = D.seed();
  let drafts = new Map();
  const tenantBooks = new Map([["CASE-0042", { db, drafts }]]);
  const shell = document.getElementById("shell");
  let current = D.route(location.hash),
    pending = false,
    error = "",
    message = "",
    scenario = "normal",
    observer,
    messagePath = "",
    hinge = null;
  const scrollPositions = new Map();
  let createDraft = { name: "", sql: "select 1 as id" };
  let activeTenant = "CASE-0042";
  const t = (vi, en) => (current.params.lang === "en" ? en : vi);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const role = () => current.params.role || "admin";
  const admin = () => D.canWrite(role());
  const url = (path, params = {}) =>
    D.href(path, {
      lang: current.params.lang || "vi",
      role: role(),
      tenant: current.params.tenant || "CASE-0042",
      platform: current.params.platform || undefined,
      ...params,
    });
  const link = (path, label, params = {}, className = "text-link") =>
    `<a class="${className}" href="${esc(url(path, params))}">${esc(label)}</a>`;
  const button = (
    action,
    label,
    primary = false,
    disabled = false,
    extra = "",
  ) =>
    `<button type="button" class="plate ${primary ? "plate-primary" : ""}" data-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${esc(label)}</button>`;
  const field = (label, control) =>
    `<label class="field"><span class="label">${esc(label)}</span>${control}</label>`;
  const input = (name, value = "", placeholder = "", extra = "") =>
    `<input class="input" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}>`;
  const select = (name, values, value, extra = "") =>
    `<select class="select" name="${name}" ${extra}>${values.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const submit = (label, disabled = false) =>
    `<button class="plate plate-primary" type="submit" ${disabled || pending ? "disabled" : ""}>${pending ? esc(t("Đang xử lý…", "Working…")) : esc(label)}</button>`;
  const stamp = (value) =>
    value
      ? esc(
          new Intl.DateTimeFormat(
            current.params.lang === "en" ? "en-GB" : "vi-VN",
            {
              dateStyle: "short",
              timeStyle: "short",
              timeZone: "Asia/Ho_Chi_Minh",
            },
          ).format(new Date(value)),
        )
      : "—";
  const statusNames = () => ({
    success: t("Thành công", "Success"),
    error: t("Cần xử lý", "Needs attention"),
    running: t("Đang chạy", "Running"),
    never: t("Chưa dựng bao giờ", "Never built"),
    skipped: t("Bỏ qua", "Skipped"),
    connected: t("Đã kết nối", "Connected"),
    needs_reconnect: t("Cần cấp lại quyền", "Reconnect required"),
    needs_scope: t("Chờ chọn dữ liệu", "Awaiting scope"),
  });
  // The last-build states the Models list marks (success, failed, other dbt status, none).
  const buildNames = () => ({
    success: t("Đã dựng", "Built"),
    error: t("Dựng lỗi", "Build failed"),
    skipped: t("Bỏ qua", "Skipped"),
    never: t("Chưa dựng bao giờ", "Never built"),
  });
  const buildStatus = (value) =>
    `<span class="status ${value}"><span class="mark" aria-hidden="true">${marks[value] || "□"}</span>${esc(buildNames()[value] || value)}</span>`;
  const marks = {
    success: "●",
    error: "◆",
    running: "◐",
    never: "○",
    skipped: "−",
    connected: "●",
    needs_reconnect: "◆",
    needs_scope: "◐",
  };
  const status = (value) =>
    `<span class="status ${value}"><span class="mark" aria-hidden="true">${marks[value] || "□"}</span>${esc(statusNames()[value] || value)}</span>`;
  const fact = (name, value) =>
    `<dl class="fact"><dt>${esc(name)}</dt><dd>${value}</dd></dl>`;
  const table = (headers, rows, caption) =>
    `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="table"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty">${esc(t("Không có dữ liệu khớp bộ lọc.", "No data matches these filters."))}</td></tr>`}</tbody></table></div>`;
  const tabs = (path, items, active, base = {}) =>
    `<nav class="views" aria-label="${esc(t("Chế độ xem", "View"))}">${items.map(([v, l]) => `<a href="${esc(url(path, { ...base, view: v }))}" ${active === v ? 'aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>`;
  const crumbs = (items) =>
    `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([path, label]) => (path ? link(path, label) : `<span aria-current="page">${esc(label)}</span>`)).join('<span aria-hidden="true">/</span>')}</nav>`;
  const guard = () =>
    `<div class="notice"><h2>${esc(t("Cần quyền quản trị", "Administrator access required"))}</h2><p>${esc(t("Vai trò thành viên chỉ xem tổng quan kho thô và mô hình. Đổi vai trò mô phỏng ở cuối trang để thử thao tác quản trị.", "Members can inspect lake summaries and models. Change the simulated role at the bottom to test administrator actions."))}</p></div>`;
  const notice = (textValue) =>
    `<div class="confirmation prose">${esc(textValue)}</div>`;
  const sourceLabel = (id) => {
    const s = db.sources.find((s) => s.id === id);
    return s ? s.name + " · " + s.account : id;
  };
  function frame(section, title, description, body) {
    const navs = [
      ["customers", t("Khách hàng", "Customers"), "#b24b1a"],
      ["sources", t("Nguồn dữ liệu", "Sources"), "#eda600"],
      ["journal", t("Nhật ký", "Journal"), "#3e782b"],
      ["lake", t("Hồ dữ liệu thô", "Raw lake"), "#0f7673"],
      ["models", t("Mô hình", "Models"), "#634cb0"],
      ["reports", t("Báo cáo", "Reports"), "#7f4023"],
      ["people", t("Người dùng", "People"), "#234c9e"],
    ];
    return `<nav class="nav" aria-label="${esc(t("Điều hướng chính", "Main navigation"))}">${navs.map(([path, name, color]) => `<a style="--color:${color}" href="${esc(url(path))}" ${section === path ? 'aria-current="page"' : ""}>${esc(name)}</a>`).join("")}</nav>
    <div class="book" style="--section:${navs.find((n) => n[0] === section)?.[2] || "#eda600"}"><div class="leaf"><header class="mast"><a class="brand" href="${esc(url("sources"))}" aria-label="Undercroft"><svg viewBox="0 0 32 32" width="36" height="36" fill="currentColor" fill-rule="evenodd" aria-hidden="true" focusable="false"><path d="M3 0h26a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3ZM5 27.5V15.5a11 11 0 0 1 22 0V27.5ZM9 27.5V15.5a7 7 0 0 1 14 0V27.5ZM12.5 27.5V15.5a3.5 3.5 0 0 1 7 0V27.5ZM5 15.5h4v1.5H5ZM23 15.5h4v1.5h-4Z"/></svg>Undercroft</a><div class="tenant"><strong>Demo Co.</strong><small>demo-001</small></div><div class="mast-right"><button class="text-link account" data-action="account">operator@example.test</button><div class="language" aria-label="Language">${["vi", "en"].map((lang) => `<a class="plate" href="${esc(url(current.path, { ...current.params, lang }))}" aria-current="${(current.params.lang || "vi") === lang ? "true" : "false"}" lang="${lang}">${lang.toUpperCase()}</a>`).join("")}</div>${button("assistant", "☛", false, false, `aria-label="${esc(t("Trợ lý (mô phỏng)", "Assistant (preview)"))}"`)}${button("logout", t("Đăng xuất", "Log out"))}</div></header>
    <div class="sheet"><aside class="margin"><span>${esc(navs.find((n) => n[0] === section)?.[1] || section)}</span></aside><main id="content" class="content page-enter" tabindex="-1"><h1>${esc(title)}</h1><p class="lead">${esc(description)}</p><p class="demo-note">${esc(t("BẢN DUYỆT R5 · Dữ liệu giả lập · Không kết nối hệ thống thật", "REVIEW R5 · Synthetic data · No production connection"))}</p>${error ? `<div class="notice" role="alert"><strong>${esc(t("Chưa hoàn tất thao tác.", "Action not completed."))}</strong><p>${esc(error)}</p></div>` : ""}${message ? `<div class="toast" role="status">${esc(message)}</div>` : ""}${pending ? `<div class="skeleton" role="status">${esc(t("Đang mô phỏng phản hồi…", "Simulating response…"))}</div>` : ""}${hinge && hinge.path === current.path ? `<section class="hinge" role="region" aria-labelledby="hinge-title"><h2 id="hinge-title" tabindex="-1">${esc(hinge.title)}</h2><div class="prose">${hinge.body}</div><div class="actions">${hinge.actions}${button("hinge-close", t("Đóng", "Close"))}</div></section>` : ""}${body}</main></div>
    <footer class="footer"><span>${esc(t("Nền đối chiếu: v1.53.0 (116a41e) · Prototype r5, không phải phiên bản phát hành", "Reference UI: v1.53.0 (116a41e) · Prototype r5, not a release"))}</span><span><a href="${document.body.dataset.docs || "docs/"}QA.md">${esc(t("Ghi chú kiểm tra", "QA notes"))}</a><a href="${document.body.dataset.docs || "docs/"}INTEGRATION-PLAN.md">${esc(t("Kế hoạch tích hợp", "Integration plan"))}</a></span></footer>
    <details class="review-tools"><summary>${esc(t("Công cụ kiểm thử bản mẫu", "Prototype test controls"))}</summary><p class="prose">${esc(t("Chỉ tác động bản mẫu trong tab này. Tải lại sẽ khôi phục dữ liệu mẫu; không có OAuth, cơ sở dữ liệu hay lệnh dựng thật.", "These controls only affect this tab. Reload restores fixtures; there is no real OAuth, database or build execution."))}</p><div class="tools-grid">${field(
      t("Vai trò mô phỏng", "Simulated role"),
      select(
        "review-role",
        [
          ["admin", t("Quản trị", "Administrator")],
          ["member", t("Thành viên", "Member")],
          ["viewer", t("Chỉ xem báo cáo", "Viewer")],
        ],
        role(),
      ),
    )}${field(
      t("Lần ghi tiếp theo", "Next write"),
      select(
        "review-scenario",
        [
          ["normal", t("Bình thường", "Normal")],
          ["fail", t("Trả lỗi một lần", "Fail once")],
          ["slow", t("Phản hồi chậm", "Slow response")],
        ],
        scenario,
      ),
    )}${button("reset", t("Khôi phục mẫu", "Reset fixtures"))}</div></details></div></div>`;
  }
  function scopeText(source, scope = source.scope) {
    const meaning = D.scopeMeaning(source.kind, scope);
    const labels = {
      unconfigured: t("Chưa chọn phạm vi", "Not configured"),
      "whole-mailbox": t(
        "Toàn bộ hộp thư (không giới hạn nhãn)",
        "Entire mailbox (no label restriction)",
      ),
      "all-spec-entities": t(
        "Tất cả danh mục connector hỗ trợ",
        "All connector-supported entities",
      ),
      "no-files": t(
        "Chưa chọn tệp hoặc thư mục nào",
        "No files or folders selected",
      ),
      "spec-plus-properties": t(
        "Thuộc tính mặc định của connector",
        "Connector default properties",
      ),
    };
    let textValue = labels[meaning.mode] || meaning.items.join(", ");
    if (!scope) return textValue;
    if (source.kind === "hubspot" && meaning.items.length)
      textValue += " + " + meaning.items.join(", ");
    if (source.kind === "drive" && scope.files.length)
      textValue +=
        " · " +
        t(
          scope.recurse ? "Có đọc thư mục con" : "Không đọc thư mục con",
          scope.recurse ? "Include subfolders" : "Exclude subfolders",
        );
    if (["drive", "gmail"].includes(source.kind))
      textValue +=
        " · " +
        (scope.fileTypes.length
          ? scope.fileTypes.join(", ")
          : t("Mọi loại tệp", "All file types"));
    return textValue;
  }
  /*
   * What saving this scope does to records the lake already holds, stated for the source's
   * kind. Never implies that anything is erased from the lake.
   */
  function scopeEffectText(source, draft) {
    const e = D.scopeEffect(source.kind, source.scope, draft);
    const lines = {
      drive: t(
        "Lần đọc đầy đủ tiếp theo sẽ đánh dấu mọi mục nằm ngoài lựa chọn mới là “đã xóa ở nguồn”. Các mục đó vẫn nằm trong kho thô và được đếm vào số đã xóa ở nguồn của luồng này; không có gì bị xóa khỏi kho.",
        "The next complete read marks every item outside the new pick as removed at source. Those items stay in the raw lake and count towards this stream's deleted-at-source figure; nothing is erased from the lake.",
      ),
      gmail: t(
        "Thư đã có trong kho mà không còn khớp nhãn nào vẫn ở trạng thái hiện hành: không bị đánh dấu đã xóa ở nguồn, và không có gì bị xóa khỏi kho. Chỉ các lần đọc sau mới theo nhãn mới.",
        "A held message that stops matching a label stays live. It is not marked removed at source, and nothing is erased from the lake. Only later reads follow the new labels.",
      ),
      xero: t(
        "Danh mục bị bỏ chọn sẽ không được đọc nữa, nên việc lưu không đánh dấu bản ghi đã có nào của nó là đã xóa ở nguồn, và không có gì bị xóa khỏi kho. Các bản ghi đó không còn được làm mới.",
        "An entity you untick is no longer read, so saving marks none of its held records removed at source, and nothing is erased from the lake. Those records are no longer refreshed.",
      ),
      hubspot: t(
        "Thuộc tính bổ sung chỉ thêm trường vào mỗi bản ghi, không đổi bản ghi nào được đọc. Việc lưu không đánh dấu bản ghi đã có nào là đã xóa ở nguồn, và không có gì bị xóa khỏi kho.",
        "Extra properties only add fields to each record; they do not change which records are read. Saving marks no held record removed at source, and nothing is erased from the lake.",
      ),
    };
    const dropped = e.dropped.length
      ? `<p class="mono">${esc(
          {
            drive: t("Rời khỏi lựa chọn: ", "Leaving the pick: "),
            gmail: t("Nhãn bị bỏ: ", "Labels leaving the scope: "),
            xero: t("Danh mục bị bỏ: ", "Entities leaving the scope: "),
            hubspot: t("Thuộc tính bị bỏ: ", "Properties leaving the scope: "),
          }[source.kind] + e.dropped.join(", "),
        )}</p>`
      : "";
    const subfolders = e.lostSubfolders
      ? `<p>${esc(t("Bỏ đọc thư mục con: mục trong thư mục con của thư mục đã chọn nằm ngoài lựa chọn mới.", "Subfolders no longer included: items inside subfolders of the chosen folders fall outside the new pick."))}</p>`
      : "";
    return `<section class="held-effect" aria-labelledby="held-effect-title"><h3 id="held-effect-title">${esc(t("Bản ghi kho đã có sẽ ra sao", "What happens to records already held"))} · ${esc(source.name)}</h3><p>${esc(lines[source.kind])}</p>${dropped}${subfolders}${["xero", "hubspot"].includes(source.kind) ? `<p class="quiet">${esc(t("Câu này cần được xác nhận với lần đọc thật trước khi đưa vào sản phẩm; đề xuất chỉ cam kết Drive và Gmail.", "This wording must be confirmed against the read before it ships; the proposal commits only to Drive and Gmail."))}</p>` : ""}</section>`;
  }
  // The write plates a card shows. For a role the server refuses them to, none is rendered.
  function sourcePlates(s) {
    return D.sourcePlates(s.status, role())
      .map((plate) =>
        plate === "run-now"
          ? button("read-source", t("Chạy ngay (mô phỏng)", "Run now (simulate)"), false, false, `data-id="${s.id}"`)
          : plate === "change-scope"
            ? link("scope/" + s.id, t("Đổi dữ liệu đồng bộ", "Change what syncs"), {}, "plate")
            : plate === "choose-scope"
              ? link("scope/" + s.id, t("Chọn dữ liệu cần đồng bộ", "Choose what to sync"), {}, "plate plate-primary")
              : plate === "reconnect"
                ? button("reconnect", t(`Kết nối lại ${s.name}`, `Reconnect ${s.name}`), true, false, `data-id="${s.id}"`)
                : plate === "connect"
                  ? button("connect", t(`Kết nối ${s.name}`, `Connect ${s.name}`), true)
                  : button("disconnect", t("Ngắt kết nối…", "Disconnect…"), false, false, `data-id="${s.id}"`),
      )
      .join("");
  }
  function sourcesPage(id) {
    const source = db.sources.find((s) => s.id === id);
    if (id && !source) return missing("sources");
    if (source) {
      const recent = db.runs.filter((r) => r.target === id);
      return frame(
        "sources",
        source.name,
        source.account,
        `${crumbs([
          ["sources", t("Nguồn dữ liệu", "Sources")],
          [null, source.id],
        ])}<div class="fact-grid">${fact(t("Kết nối", "Connection"), status(source.status))}${fact(t("Định danh tài khoản", "Connection identity"), esc(source.id))}${fact(t("Phạm vi hiện hành", "Saved scope"), esc(scopeText(source)))}${fact(t("Lịch đọc", "Schedule"), esc(source.cadence === "paused" ? t("Đã tạm dừng", "Paused") : source.cadence))}</div><div class="actions">${sourcePlates(source)}${admin() ? link("schedule/" + id, t("Lịch đọc", "Schedule"), {}, "plate") : ""}${link("journal", t("Lần chạy của tài khoản này", "Runs of this account"), { source: id }, "plate")}</div>${admin() ? `<div class="inner-grid"><section class="panel"><h2>${esc(t("Dữ liệu đã vào kho", "Landed data"))}</h2><p class="prose">${esc(t("Xem bản ghi theo đúng tài khoản này; không gộp các kết nối cùng loại.", "Inspect records from this exact account; instances of the same connector stay separate."))}</p>${link("lake", t("Mở kho thô", "Open raw lake"), { source: id })}</section></div>` : ""}<h2>${esc(t("Lần chạy gần đây của kết nối", "Recent runs of this connection"))}</h2>${runTable(recent)}${admin() ? `<p class="quiet">${esc(t("Ngắt kết nối luôn cần xác nhận và không xóa dữ liệu đã vào kho.", "Disconnecting always asks first and does not erase landed records."))}</p>` : ""}`,
      );
    }
    const query = current.params.q || "";
    const sources = db.sources.filter((s) =>
      (s.name + " " + s.account).toLowerCase().includes(query.toLowerCase()),
    );
    return frame(
      "sources",
      t("Nguồn dữ liệu", "Data sources"),
      t(
        "Biết dữ liệu đến từ đâu, kết nối nào cần xử lý và lần đọc tiếp theo được cấu hình ra sao.",
        "See where data comes from, which connections need attention and how each read is scheduled.",
      ),
      `<div class="summary four"><div><strong>${db.sources.length}</strong><span>${esc(t("Kết nối", "Connections"))}</span></div><div><strong>${db.sources.filter((s) => s.status === "connected").length}</strong><span>${esc(t("Đã kết nối", "Connected"))}</span></div><div><strong>${db.sources.filter((s) => s.status !== "connected").length}</strong><span>${esc(t("Cần xử lý", "Needs attention"))}</span></div><div><strong>${new Set(db.sources.map((s) => s.kind)).size}</strong><span>${esc(t("Loại nguồn", "Connector types"))}</span></div></div><form class="filters" data-form="source-filter">${field(t("Tìm nguồn hoặc tài khoản", "Find source or account"), input("q", query, t("Tên nguồn, email…", "Source name, email…")))}<div class="actions">${submit(t("Tìm", "Search"))}${admin() ? button("connect", t("Kết nối thêm tài khoản…", "Connect another account…")) : ""}</div></form>${sources.length ? sources.map((s) => `<article class="source-row"><div class="source-top"><div class="source-title"><span class="source-icon" aria-hidden="true">${s.name[0]}</span><div><h2>${link("source/" + s.id, s.name)}</h2><span class="mono quiet">${esc(s.account)}</span></div></div><div>${status(s.status)}<div class="sub">${esc(s.id)}</div></div><div class="next-run"><span class="label">${esc(t("Nhịp đọc đã lưu", "Saved cadence"))}</span><div class="mono">${esc(s.cadence)}</div></div><div class="actions">${sourcePlates(s)}${link("journal", t("Lần chạy", "Runs"), { source: s.id }, "plate")}${link("source/" + s.id, t("Chi tiết", "Details"), {}, "plate")}</div></div><details class="accounts"><summary>${esc(t("Xem phạm vi đang đọc", "View current scope"))}</summary><div class="source-detail"><p class="prose">${esc(scopeText(s))}</p>${admin() ? link("schedule/" + s.id, t("Chỉnh lịch đọc", "Edit schedule")) : ""}</div></details></article>`).join("") : `<div class="empty">${esc(t("Không tìm thấy nguồn.", "No sources found."))}</div>`}`,
    );
  }
  function getScopeDraft(source) {
    const key = "scope:" + source.id;
    if (!drafts.has(key))
      drafts.set(key, D.clone(source.scope || D.emptyScope(source.kind)));
    return drafts.get(key);
  }
  function choice(name, value, label, checked, description = "") {
    return `<label class="choice"><input type="checkbox" name="${esc(name)}" value="${esc(value)}" ${checked ? "checked" : ""}><span><span class="mono">${esc(label)}</span>${description ? `<span class="sub">${esc(description)}</span>` : ""}</span></label>`;
  }
  function scopePage(id) {
    const source = db.sources.find((s) => s.id === id);
    if (!source) return missing("sources");
    if (!admin())
      return frame(
        "sources",
        t("Phạm vi kết nối", "Connection scope"),
        sourceLabel(id),
        guard(),
      );
    const draft = getScopeDraft(source),
      review = current.params.step === "review";
    let controls = "";
    if (source.kind === "gmail")
      controls = `<fieldset class="choices"><legend>${esc(t("Nhãn thư", "Mail labels"))}</legend>${notice(t("Không chọn nhãn = đọc toàn bộ hộp thư. Đây không phải là tắt đọc.", "No selected labels means read the entire mailbox, not disable reading."))}<div class="choice-grid">${[
        "INBOX",
        "FINANCE",
        "SUPPORT",
      ]
        .map((v) =>
          choice(
            "labels",
            v,
            v,
            draft.labels.some((label) => label.id === v),
          ),
        )
        .join("")}</div></fieldset>${fileTypes(draft)}`;
    if (source.kind === "xero")
      controls = `${field(t("Tổ chức đã cấp quyền", "Authorized organisation"), select("organisation", [["demo-org", "Demo Company Pte. Ltd."]], draft.organisation.id))}<fieldset class="choices"><legend>${esc(t("Danh mục được đọc", "Entities to read"))}</legend>${notice(t("Không chọn danh mục = đọc tất cả danh mục connector hỗ trợ (20 danh mục).", "No selected entities means all 20 connector-supported entities."))}<div class="choice-grid">${D.xeroEntities.map((v) => choice("entities", v, v, draft.entities.includes(v))).join("")}</div></fieldset>`;
    if (source.kind === "hubspot")
      controls = `${notice(t("Các đối tượng và thuộc tính mặc định do connector quy định. Đây chỉ là thuộc tính bổ sung theo từng đối tượng; không phải quyền bật/tắt đối tượng.", "The connector defines default objects and properties. Choose extra properties per object, not which objects to enable."))}${["contacts", "companies", "deals"].map((entity) => `<fieldset class="choices"><legend>${entity}</legend><div class="choice-grid">${(entity === "contacts" ? ["jobtitle", "department"] : entity === "companies" ? ["industry", "annualrevenue"] : ["dealstage", "pipeline"]).map((p) => choice("prop:" + entity, p, p, (draft.properties[entity] || []).includes(p))).join("")}</div></fieldset>`).join("")}`;
    if (source.kind === "drive")
      controls = `<fieldset class="choices"><legend>${esc(t("Tệp và thư mục được chọn", "Selected files and folders"))}</legend><p class="prose">${esc(t("Dưới đây là danh sách giả lập cho Google Picker. Không chọn gì = không đọc tệp nào; không có nghĩa toàn bộ Drive.", "This fixture list stands in for Google Picker. Selecting nothing means no files, not the whole Drive."))}</p><div class="choice-grid">${[
        ["folder-finance", "Demo finance"],
        ["folder-support", "Demo support"],
        ["file-handbook", "Sample handbook.pdf"],
      ]
        .map(([v, l]) =>
          choice(
            "files",
            v,
            l,
            draft.files.some((f) => f.id === v),
          ),
        )
        .join(
          "",
        )}</div>${choice("recurse", "yes", t("Bao gồm thư mục con của thư mục đã chọn", "Include subfolders of selected folders"), draft.recurse)}</fieldset>${fileTypes(draft)}`;
    const before = scopeText(source),
      after = scopeText(source, draft);
    const body = `${crumbs([
      ["sources", t("Nguồn dữ liệu", "Sources")],
      ["source/" + id, source.name],
      [null, t("Phạm vi", "Scope")],
    ])}<div class="scope-echo"><span class="label">${esc(t("Tài khoản cố định cho lần chỉnh này", "Account for this edit"))}</span><p class="mono">${esc(source.account)} · ${esc(id)}</p></div><nav class="steps" aria-label="${esc(t("Các bước chọn phạm vi", "Scope steps"))}"><a href="${esc(url("scope/" + id))}" ${!review ? 'aria-current="step"' : ""}>01 · ${esc(t("Chọn phạm vi", "Choose scope"))}</a><a href="${esc(url("scope/" + id, { step: "review" }))}" ${review ? 'aria-current="step"' : ""}>02 · ${esc(t("Kiểm tra & lưu", "Review & save"))}</a></nav>${review ? `<h2>${esc(t("Kiểm tra thay đổi", "Review changes"))}</h2>${table([t("Đã lưu", "Saved"), t("Sẽ áp dụng", "Will apply")], [[esc(before), esc(after)]], t("So sánh phạm vi", "Scope comparison"))}${scopeEffectText(source, draft)}<div class="wizard-actions">${link("scope/" + id, t("← Chỉnh lại", "← Back to edit"), {}, "plate")}${button("scope-save", t("Lưu phạm vi (mô phỏng)", "Save scope (simulate)"), true, pending, `data-id="${id}"`)}${button("scope-cancel", t("Hủy thay đổi", "Discard changes"), false, pending, `data-id="${id}"`)}</div>` : `<form data-form="scope" data-id="${id}">${controls}<div class="wizard-actions">${button("scope-cancel", t("Hủy thay đổi", "Discard changes"), false, pending, `data-id="${id}"`)}${submit(t("Tiếp: kiểm tra thay đổi →", "Next: review changes →"))}</div></form>`}<p class="quiet">${esc(t("Lịch đọc là cài đặt riêng, không nằm trong luồng chọn phạm vi. Bản nháp được giữ khi quay lại trong tab này.", "Scheduling is separate from scope. Your draft is retained when navigating within this tab."))} ${link("schedule/" + id, t("Mở lịch đọc", "Open schedule"))}</p>`;
    return frame(
      "sources",
      t("Chỉnh phạm vi", "Edit read scope"),
      t(
        "Chọn đúng dữ liệu cho đúng tài khoản, kiểm tra rồi mới lưu.",
        "Select the right data for this account, review it, then save.",
      ),
      body,
    );
  }
  function fileTypes(draft) {
    return `<fieldset class="choices"><legend>${esc(t("Loại tệp đính kèm / tài liệu", "Attachment / document types"))}</legend><p class="prose">${esc(t("Bỏ chọn tất cả = mọi loại tệp.", "No selections means all file types."))}</p><div class="choice-grid">${["application/pdf", "text/plain", "application/vnd.google-apps.document"].map((v) => choice("fileTypes", v, v, draft.fileTypes.includes(v))).join("")}</div></fieldset>`;
  }
  function schedulePage(id) {
    const source = db.sources.find((s) => s.id === id);
    if (!source) return missing("sources");
    const key = "schedule:" + id;
    if (!drafts.has(key))
      drafts.set(key, { cadence: source.cadence, resync: source.resync });
    const draft = drafts.get(key);
    return frame(
      "sources",
      t("Lịch đọc", "Read schedule"),
      sourceLabel(id),
      `${crumbs([
        ["sources", t("Nguồn dữ liệu", "Sources")],
        ["source/" + id, source.name],
        [null, t("Lịch đọc", "Schedule")],
      ])}${
        !admin()
          ? guard()
          : `<form data-form="schedule" data-id="${id}"><div class="inner-grid"><section class="panel"><h2>${esc(t("Đọc thay đổi", "Incremental reads"))}</h2>${field(
              t("Tần suất", "Cadence"),
              select(
                "cadence",
                [
                  ["1h", t("Mỗi giờ", "Hourly")],
                  ["6h", t("Mỗi 6 giờ", "Every 6 hours")],
                  ["24h", t("Hằng ngày", "Daily")],
                  ["paused", t("Tạm dừng", "Paused")],
                ],
                draft.cadence,
              ),
            )}</section><section class="panel"><h2>${esc(t("Đọc toàn bộ lại", "Full resync"))}</h2>${field(
              t("Chu kỳ", "Interval"),
              select(
                "resync",
                [
                  ["7d", t("Mỗi 7 ngày", "Every 7 days")],
                  ["30d", t("Mỗi 30 ngày", "Every 30 days")],
                  ["off", t("Không định kỳ", "Not scheduled")],
                ],
                draft.resync,
              ),
            )}</section></div>${notice(t("Mẫu này chỉ minh họa các chu kỳ định sẵn. Khi tích hợp phải giữ ScheduleControl gốc, cron tùy chỉnh và lịch chạy tiếp do máy chủ tính; không tính giờ chạy giả trong trình duyệt.", "This prototype demonstrates presets only. Integration must retain the original ScheduleControl, custom cron and server-computed next-run times."))}<div class="actions">${submit(t("Lưu lịch (mô phỏng)", "Save schedule (simulate)"))}${button("schedule-cancel", t("Hủy thay đổi", "Discard changes"), false, pending, `data-id="${id}"`)}</div></form>`
      }`,
    );
  }
  function runTable(runs) {
    return table(
      [
        t("Lần chạy", "Run"),
        t("Đối tượng", "Target"),
        t("Trạng thái", "Status"),
        t("Thời điểm · UTC+7", "Time · UTC+7"),
        t("Đọc / ghi", "Read / written"),
      ],
      runs.map((r) => [
        link("journal/" + r.id, r.id, {}, "mono text-link"),
        `<span class="mono">${esc(r.target)}</span><span class="sub">${r.type === "build" ? t("Dựng mô hình", "Model build") : t("Đọc nguồn", "Source read")}</span>`,
        status(r.status),
        stamp(r.time),
        `${r.read} / ${r.written}`,
      ]),
      t("Lịch sử chạy", "Run history"),
    );
  }
  // Per-entity created/changed counts. Admin: each count opens the records that run wrote.
  // Member/viewer: plain figures, no link.
  function runCounts(r) {
    if (!r.entities.length)
      return `<p class="quiet">${esc(t("Lần chạy này không tạo hay đổi bản ghi nào.", "This run created or changed no records."))}</p>`;
    const cell = (e, change) => {
      const n = e[change];
      if (!n || !D.canReadRaw(role())) return `<span class="mono">${n}</span>`;
      const later = D.runWrites(r.id, e.entity, change, db.records).later.length;
      return `${link("lake", String(n), { run: r.id, entity: e.entity, change, source: r.target }, "mono text-link")}${later ? `<span class="sub">${esc(t(`${later} nay thuộc về một lần chạy sau`, `${later} now attributed to a later run`))}</span>` : ""}`;
    };
    return table(
      [t("Danh mục", "Entity"), t("Tạo mới", "Created"), t("Thay đổi", "Changed")],
      r.entities.map((e) => [`<span class="mono">${esc(e.entity)}</span>`, cell(e, "created"), cell(e, "changed")]),
      t("Bản ghi lần chạy đã ghi, theo danh mục", "Records this run wrote, per entity"),
    );
  }
  function journalPage(id) {
    if (id) {
      const r = db.runs.find((r) => r.id === id);
      if (!r) return missing("journal");
      const view = current.params.view || "overview";
      const destination =
        r.type === "build" ? "model/" + r.target : "source/" + r.target;
      const source = db.sources.find((s) => s.id === r.target);
      const scopeFact =
        r.type === "read"
          ? fact(
              t("Phạm vi lúc bắt đầu", "Scope at start"),
              r.scopeAtStart === null || !source
                ? `<span title="${esc(t("Lần chạy ghi trước khi có trường này", "Recorded before runs kept their scope"))}">—</span>`
                : esc(scopeText(source, r.scopeAtStart)),
            )
          : "";
      return frame(
        "journal",
        r.id,
        t(
          "Theo dõi một lần chạy từ đầu vào đến kết quả, không lẫn lịch sử các tài khoản.",
          "Follow one execution from input to result, without mixing account histories.",
        ),
        `${crumbs([
          ["journal", t("Nhật ký", "Journal")],
          [null, id],
        ])}<div class="fact-grid">${fact(t("Trạng thái", "Status"), status(r.status))}${fact(t("Đối tượng", "Target"), link(destination, r.target))}${fact(t("Bắt đầu · UTC+7", "Started · UTC+7"), stamp(r.time))}${fact(t("Đọc / ghi", "Read / written"), r.read + " / " + r.written)}${scopeFact}</div>${tabs(
          "journal/" + id,
          [
            ["overview", t("Tổng quan", "Overview")],
            ["events", t("Sự kiện", "Events")],
            ["rejections", t("Bản ghi bị từ chối", "Rejected records")],
          ],
          view,
        )}${view === "overview" ? `<div class="run-flow">${[t("Tiếp nhận", "Accepted"), r.type === "build" ? t("Biên dịch SQL", "Compile SQL") : t("Đọc nguồn", "Read source"), r.type === "build" ? t("Dựng & kiểm thử", "Build & test") : t("Ghi kho thô", "Land raw data"), t("Kết quả", "Result")].map((s, i) => `<div class="station ${r.status === "running" && i === 2 ? "is-running" : ""}"><span class="label">0${i + 1}</span><h3>${esc(s)}</h3>${i === 3 ? status(r.status) : esc(i === 2 && r.status === "error" ? t("Thất bại", "Failed") : i > 1 && r.status === "running" ? t("Đang chờ", "Pending") : t("Đã ghi nhận", "Recorded"))}</div>`).join("")}</div>${r.type === "read" ? `<h2>${esc(t("Bản ghi đã ghi theo danh mục", "Records written, per entity"))}</h2>${runCounts(r)}` : ""}${r.error ? `<div class="notice"><h2>${esc(t("Nguyên nhân mẫu", "Fixture failure reason"))}</h2><p class="mono">${esc(r.error)}</p>${link(destination, t("Mở đối tượng để xử lý", "Open target to investigate"))}</div>` : notice(t("Không có lỗi được ghi nhận trong dữ liệu mẫu này.", "No failure recorded in this fixture."))}<div class="actions">${link(destination, t("Về đối tượng", "Open target"), {}, "plate")}${r.type === "read" ? link("journal", t("Các lần chạy khác của tài khoản này", "Other runs of this account"), { source: r.target }, "plate") : link("models", t("Xem thượng nguồn", "Inspect upstream"), { view: "graph", node: r.target }, "plate")}</div>` : view === "events" ? `<ol class="feed">${[t("Lần chạy được tiếp nhận", "Execution accepted"), t("Bắt đầu xử lý đối tượng", "Target processing started"), r.error || t("Kết quả đã được ghi nhận", "Result recorded")].map((s, i) => `<li><span class="mono">${esc(id)} · ${i + 1}</span><span>${esc(s)}</span></li>`).join("")}</ol>` : `<div class="empty">${esc(t("Không có bản ghi từ chối trong fixture này. Lỗi cấp quyền hoặc lỗi dựng không đồng nghĩa có một bản ghi bị từ chối.", "This fixture contains no rejected records. An authorization or build failure is not itself a rejected data record."))}</div>`}`,
      );
    }
    const p = current.params,
      query = p.q || "",
      filter = p.status || "all",
      onlySource = db.sources.find((s) => s.id === p.source);
    let runs = db.runs
      .filter(
        (r) =>
          (filter === "all" || r.status === filter) &&
          (!p.source || r.target === p.source) &&
          (r.id + " " + r.target).toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) => b.time.localeCompare(a.time));
    const page = Math.min(
      Math.max(Number(p.page) || 1, 1),
      Math.max(1, Math.ceil(runs.length / 6)),
    );
    return frame(
      "journal",
      t("Nhật ký thực thi", "Execution journal"),
      t(
        "Bắt đầu từ lần chạy cần xử lý, rồi đi thẳng đến đúng nguồn hoặc mô hình.",
        "Start with a run that needs attention and open its exact source or model.",
      ),
      `${notice(t("Tìm kiếm và lọc dưới đây chạy trên toàn bộ fixture. API hiện tại chỉ phân trang; lọc xuyên toàn lịch sử cần hợp đồng máy chủ bổ sung.", "Search and filters here cover the complete fixture. The current API paginates only; cross-history filtering needs a server contract extension."))}${onlySource ? `<p class="results filter-echo">${esc(t("Chỉ lần chạy của", "Runs of one account only:"))} <span class="mono">${esc(onlySource.name + " · " + onlySource.account)}</span> · ${link("journal", t("Bỏ lọc tài khoản", "Clear account filter"), { ...p, source: "", page: "" })}</p>` : ""}<form class="filters" data-form="journal-filter">${field(t("Tài khoản nguồn", "Source account"), select("source", [["", t("Mọi tài khoản", "All accounts")], ...db.sources.map((s) => [s.id, s.name + " · " + s.account])], p.source || ""))}${field(t("Tìm lần chạy / đối tượng", "Find run / target"), input("q", query))}${field(t("Trạng thái", "Status"), select("status", [["all", t("Tất cả", "All")], ...["success", "error", "skipped"].map((s) => [s, statusNames()[s]])], filter))}<div class="actions">${submit(t("Áp dụng", "Apply"))}${link("journal", t("Xóa lọc", "Clear filters"), {}, "plate")}</div></form><p class="results">${runs.length} ${esc(t("lần chạy khớp · trang", "matching runs · page"))} ${page} / ${Math.max(1, Math.ceil(runs.length / 6))}</p>${runTable(runs.slice((page - 1) * 6, page * 6))}<div class="actions">${page > 1 ? link("journal", t("← Trước", "← Previous"), { ...p, page: page - 1 }, "plate") : ""}${page * 6 < runs.length ? link("journal", t("Sau →", "Next →"), { ...p, page: page + 1 }, "plate") : ""}</div>`,
    );
  }
  function lakePage(id) {
    if (id === "console") return consolePage();
    if (id) {
      const record = db.records.find((r) => r.id === id);
      if (!record) return missing("lake");
      if (!D.canReadRaw(role()))
        return frame("lake", id, t("Bản ghi thô", "Raw record"), guard());
      return frame(
        "lake",
        id,
        t(
          "Payload gốc được giữ nguyên dạng chuỗi; không đọc lại số lớn bằng JavaScript.",
          "The original payload stays a string; large numbers are not reparsed by JavaScript.",
        ),
        `${crumbs([
          ["lake", t("Kho thô", "Raw lake")],
          [null, id],
        ])}<div class="fact-grid">${fact(t("Nguồn", "Source"), link("source/" + record.source, record.source))}${fact(t("Danh mục", "Entity"), link("lake", record.entity, { source: record.source, entity: record.entity }))}${fact(t("Lần chạy ghi gần nhất", "Last written by run"), link("journal/" + record.run, record.run))}${fact(t("Các lần chạy đã ghi", "Written by runs"), record.writes.map((w) => `${link("journal/" + w.run, w.run)} <span class="quiet">${esc(w.change === "created" ? t("tạo", "created") : t("đổi", "changed"))}</span>`).join("<br>"))}${fact(t("Đã ghi · UTC+7", "Landed · UTC+7"), stamp(record.landedAt))}</div><h2>${esc(t("Nội dung nguyên bản", "Raw payload"))}</h2><pre class="raw" tabindex="0">${esc(record.payload)}</pre><div class="actions">${button("copy-record", t("Sao chép chuỗi gốc", "Copy original string"), false, false, `data-id="${id}"`)}${link("lake", t("Về danh sách cùng luồng", "Back to stream"), { source: record.source, entity: record.entity }, "plate")}</div>`,
      );
    }
    const p = current.params;
    const { records, later } = lakeFilter(p);
    const changeName =
      p.change === "created"
        ? t("tạo mới", "created")
        : p.change === "changed"
          ? t("thay đổi", "changed")
          : t("tạo hoặc đổi", "created or changed");
    const runEcho = p.run
      ? `<div class="run-echo"><p class="results">${esc(t("Bản ghi do lần chạy", "Records written by run"))} ${link("journal/" + p.run, p.run, {}, "mono text-link")} ${esc(changeName)}${p.entity ? ` · <span class="mono">${esc(p.entity)}</span>` : ""}: ${records.length + later.length}</p>${later.length ? notice(t(`${later.length} trong số đó nay thuộc về một lần chạy sau (${[...new Set(later.map((r) => r.run))].join(", ")}), nên danh sách dưới chỉ còn ${records.length}. Danh sách này không phải toàn bộ đầu ra của lần chạy.`, `${later.length} of them ${later.length === 1 ? "is" : "are"} now attributed to a later run (${[...new Set(later.map((r) => r.run))].join(", ")}), so the list below shows ${records.length}. It is not this run's whole output.`)) + `<div class="actions">${[...new Set(later.map((r) => r.run))].map((run) => link("lake", t(`Xem bản ghi của ${run}`, `Records of ${run}`), { run, entity: p.entity, source: p.source }, "plate")).join("")}</div>` : ""}</div>`
      : "";
    const streams = [...new Set(db.records.map(D.streamKey))];
    const content = `<div class="summary four"><div><strong>${db.records.length}</strong><span>${esc(t("Bản ghi mẫu", "Fixture records"))}</span></div><div><strong>${streams.length}</strong><span>${esc(t("Luồng nguồn × danh mục", "Source × entity streams"))}</span></div><div><strong>${new Set(db.records.map((r) => r.source)).size}</strong><span>${esc(t("Kết nối có dữ liệu", "Connections with data"))}</span></div><div><strong>UTC+7</strong><span>${esc(t("Múi giờ hiển thị", "Display timezone"))}</span></div></div><h2>${esc(t("Danh mục luồng dữ liệu", "Stream inventory"))}</h2><div class="stream-list">${streams
      .map((key) => {
        const [source, entity] = key.split("::");
        return link(
          "lake",
          source +
            " → " +
            entity +
            " · " +
            db.records.filter((r) => D.streamKey(r) === key).length,
          { source, entity },
        );
      })
      .join("")}</div>${
      !admin()
        ? `${notice(t("Thành viên xem được tổng quan. Bản ghi thô, tìm nội dung và SQL console dành cho quản trị.", "Members can view this summary. Raw records, content search and SQL console require administrator access."))}`
        : `<div class="toolbar"><h2>${esc(t("Bản ghi", "Records"))}</h2>${link("lake/console", t("SQL console (mô phỏng)", "SQL console (simulate)"), {}, "plate")}</div><form class="filters" data-form="lake-filter">${field(t("Kết nối", "Connection"), select("source", [["", t("Tất cả kết nối", "All connections")], ...db.sources.map((s) => [s.id, s.name + " · " + s.account])], p.source || ""))}${field(t("Danh mục", "Entity"), input("entity", p.entity || "", t("Ví dụ: invoices", "Example: invoices")))}${field(t("Tìm trong payload", "Search payload"), input("q", p.q || ""))}<div class="actions">${submit(t("Áp dụng", "Apply"))}${link("lake", t("Xóa lọc", "Clear filters"), {}, "plate")}</div></form>${runEcho}<p class="results">${records.length} / ${db.records.length} ${esc(t("bản ghi mẫu", "fixture records"))}</p>${table(
            [
              t("Bản ghi", "Record"),
              t("Kết nối", "Connection"),
              t("Danh mục", "Entity"),
              t("Ghi vào kho · UTC+7", "Landed · UTC+7"),
            ],
            records.map((r) => [
              link("lake/" + r.id, r.id),
              link("source/" + r.source, r.source),
              esc(r.entity),
              stamp(r.landedAt),
            ]),
            t("Bản ghi thô", "Raw records"),
          )}<div class="actions">${button("export-records", t("Tải CSV kết quả đang lọc", "Download filtered CSV"))}</div>`
    }`;
    return frame(
      "lake",
      t("Hồ dữ liệu thô", "Raw data lake"),
      t(
        "Tách bạch tài khoản, danh mục và payload. Đây là bằng chứng gốc, không phải bảng số liệu đã diễn giải.",
        "Keep accounts, entities and payloads distinct. This is source evidence, not interpreted business metrics.",
      ),
      content,
    );
  }
  /*
   * Records matching the Raw lake filters. With a run: the records that run wrote (for the
   * entity and change asked), split into those still attributed to it and those a later run
   * has rewritten since.
   */
  function lakeFilter(p) {
    const matching = db.records.filter(
      (r) =>
        (!p.source || r.source === p.source) &&
        (!p.entity || r.entity === p.entity) &&
        (!p.q || r.payload.toLowerCase().includes(p.q.toLowerCase())),
    );
    if (!p.run) return { records: matching, later: [] };
    const wrote = matching.filter((r) =>
      r.writes.some(
        (w) => w.run === p.run && (!p.change || w.change === p.change),
      ),
    );
    return {
      records: wrote.filter((r) => r.run === p.run),
      later: wrote.filter((r) => r.run !== p.run),
    };
  }
  let consoleResult = null,
    consoleSQL = "SELECT source, entity, id FROM raw.records LIMIT 20;";
  function consolePage() {
    return frame(
      "lake",
      "SQL console",
      t(
        "Bản mô phỏng đọc dữ liệu, không kết nối PostgreSQL.",
        "Read-only interaction demo, not connected to PostgreSQL.",
      ),
      `${crumbs([
        ["lake", t("Kho thô", "Raw lake")],
        [null, "SQL console"],
      ])}${
        !admin()
          ? guard()
          : `${notice(t("Chỉ câu truy vấn mẫu được thực thi trên fixture. Câu khác trả thông báo không hỗ trợ; đây không phải bộ phân tích SQL hay cơ chế bảo mật của hệ thật.", "Only the sample query runs against fixtures. Other queries return an unsupported message. This is not a SQL parser or production security boundary."))}<form data-form="console">${field(t("Câu truy vấn mẫu", "Sample query"), `<textarea name="sql" class="editor" rows="5" spellcheck="false">${esc(consoleSQL)}</textarea>`)}<div class="actions">${submit(t("Chạy mẫu", "Run sample"))}${button("console-example", t("Nạp truy vấn mẫu", "Load sample query"))}</div></form>${
              consoleResult
                ? `<h2>${esc(t("Kết quả mẫu", "Fixture result"))}</h2>${table(
                    ["source", "entity", "id"],
                    consoleResult.map((r) => [
                      esc(r.source),
                      esc(r.entity),
                      link("lake/" + r.id, r.id),
                    ]),
                    "SQL fixture result",
                  )}`
                : ""
            }`
      }`,
    );
  }
  // One count per last-build state the list marks, "never built" included. The counts
  // partition the models the list covers, so they add up to it.
  function modelSummary(listed) {
    const totals = D.counts(listed),
      filter = current.params.status || "all";
    const to = (s) =>
      url("models", {
        view: "list",
        status: s === "all" ? "" : s,
        q: current.params.q,
        sort: current.params.sort,
      });
    return `<nav class="summary build-summary" aria-label="${esc(t("Lọc danh sách theo lần dựng gần nhất", "Filter the list by last build"))}">${D.buildStates.map((s) => `<a href="${esc(to(s))}" ${s === filter ? 'aria-current="true"' : ""}><strong>${totals[s]}</strong><span>${buildStatus(s)}</span></a>`).join("")}<a class="summary-all" href="${esc(to("all"))}" ${filter === "all" ? 'aria-current="true"' : ""}><strong>${totals.all}</strong><span>${esc(t("Tất cả mô hình", "All models"))}</span></a></nav><p class="quiet sum-line">${esc(D.buildStates.map((s) => totals[s]).join(" + ") + " = " + totals.all + " " + t("mô hình trong danh sách", "models listed"))}</p>`;
  }
  function modelsPage() {
    const view = current.params.view || "list";
    let content = tabs(
      "models",
      [
        ["list", t("Danh sách", "List")],
        ["graph", t("Dòng dữ liệu", "Lineage")],
      ],
      view,
    );
    if (view === "graph") content += graphView();
    else {
      const p = current.params;
      const searched = db.models.filter(
        (m) => !p.q || m.name.includes(p.q.toLowerCase()),
      );
      let models = searched.filter(
        (m) => !p.status || p.status === "all" || m.status === p.status,
      );
      const order = { error: 0, skipped: 1, never: 2, success: 3 };
      models.sort(
        p.sort === "name"
          ? (a, b) => a.name.localeCompare(b.name)
          : (a, b) => order[a.status] - order[b.status],
      );
      content += `${modelSummary(searched)}<div class="toolbar"><span class="quiet">${esc(t("Lần dựng gần nhất và bản SQL đã lưu", "Last build and saved SQL"))}</span>${admin() ? link("model-new", t("Tạo mô hình", "Create model"), {}, "plate plate-primary") : ""}</div><form class="filters" data-form="model-filter">${field(t("Tìm mô hình", "Find model"), input("q", p.q || ""))}${field(
        t("Sắp xếp", "Sort"),
        select(
          "sort",
          [
            ["attention", t("Cần chú ý trước", "Attention first")],
            ["name", t("Tên A → Z", "Name A → Z")],
          ],
          p.sort || "attention",
        ),
      )}<input type="hidden" name="status" value="${esc(p.status || "all")}"><div class="actions">${submit(t("Áp dụng", "Apply"))}${link("models", t("Xóa lọc", "Clear filters"), {}, "plate")}</div></form><p class="results">${models.length} / ${db.models.length} ${esc(t("mô hình", "models"))}</p>${table(
        [
          t("Tên", "Name"),
          t("Lần dựng gần nhất", "Last build"),
          t("Lần dựng", "Build run"),
          t("Số cột", "Columns"),
          t("Cập nhật SQL · UTC+7", "SQL updated · UTC+7"),
        ],
        models.map((m) => [
          link("model/" + m.name, m.name, {}, "mono text-link") +
            (isModelDirty(m)
              ? `<span class="sub">${esc(t("Bản nháp chưa lưu", "Unsaved draft"))}</span>`
              : ""),
          buildStatus(m.status),
          m.lastRun ? link("journal/" + m.lastRun, m.lastRun) : "—",
          m.columns ?? "—",
          stamp(m.updatedAt) + `<span class="sub">${esc(m.updatedBy)}</span>`,
        ]),
        t("Mô hình dữ liệu", "Data models"),
      )}<p class="quiet">${esc(t("Mỗi dòng mang đúng một trạng thái lần dựng gần nhất mà danh sách đang đánh dấu; “Chưa dựng bao giờ” là mô hình chưa có lần dựng nào được ghi. Không gán “phiên bản” giả cho từng mô hình.", "Each row carries exactly one of the last-build states the list already marks; “Never built” means no build has been recorded for the model. No invented per-model versions."))}</p>`;
    }
    return frame(
      "models",
      t("Mô hình dữ liệu", "Data models"),
      t(
        "Đọc tình trạng trong danh sách; hiểu quan hệ trong sơ đồ. Hai cách xem có điều khiển riêng.",
        "Inspect state in the list; understand dependencies in lineage. Each view has its own controls.",
      ),
      content,
    );
  }
  function getModelDraft(model) {
    const key = "model:" + model.name;
    if (!drafts.has(key))
      drafts.set(key, { sql: model.sql, tests: D.clone(model.tests) });
    return drafts.get(key);
  }
  const isModelDirty = (model) => {
    const d = drafts.get("model:" + model.name);
    return (
      !!d &&
      (d.sql !== model.sql ||
        JSON.stringify(d.tests) !== JSON.stringify(model.tests))
    );
  };
  function modelPage(name) {
    const m = db.models.find((m) => m.name === name);
    if (!m) return missing("models");
    const draft = getModelDraft(m),
      view = current.params.view || "sql",
      dirty = isModelDirty(m);
    let panel = "";
    if (view === "sql")
      panel = `<form data-form="model-save" data-id="${name}">${field("SQL", `<textarea class="editor" rows="13" name="${view}" spellcheck="false" ${!admin() ? "readonly" : ""}>${esc(draft[view])}</textarea>`)}<div class="actions">${submit(t("Lưu bản nháp (mô phỏng)", "Save draft (simulate)"), !admin() || !dirty)}${button("model-discard", t("Bỏ thay đổi", "Discard draft"), false, !dirty, `data-id="${name}"`)}</div></form>`;
    if (view === "tests") panel = testPanel(m, draft, dirty);
    if (view === "history")
      panel = runTable(db.runs.filter((r) => r.target === name));
    if (view === "preview")
      panel =
        role() === "viewer"
          ? notice(
              t(
                "Vai trò viewer không chạy truy vấn ad-hoc. Giữ đường đọc qua báo cáo đã lưu như hệ gốc.",
                "Viewers cannot run ad-hoc queries. Retain access through saved reports as in the original app.",
              ),
            )
          : m.status === "never"
            ? `<div class="empty">${esc(t("Chưa có dữ liệu: mô hình chưa từng dựng.", "No data: this model has never been built."))}</div>`
            : m.status !== "success"
              ? notice(
                  t(
                    "Không có preview thành công cho lần dựng đang chọn. Xem nhật ký để biết nguyên nhân.",
                    "No successful preview for the selected build. Inspect the run for details.",
                  ),
                )
              : `${notice(t("Bảng dưới là 3 hàng fixture, không phải kết quả chạy SQL. Preview hệ thật có giới hạn; không suy ra tổng số dòng từ số hàng preview.", "These are 3 fixture rows, not executed SQL. Real previews are limited; their length is not the total row count."))}${table(
                  ["id", "name"],
                  [
                    ["DEMO-1", "Example A"],
                    ["DEMO-2", "Example B"],
                    ["DEMO-3", "Example C"],
                  ],
                  t("Preview minh họa", "Synthetic preview"),
                )}`;
    if (view === "references") {
      const { nodes, edges } = D.graph(db.models);
      const inputs = edges
        .filter((e) => e.to === name)
        .map((e) => {
          const n = nodes.find((node) => node.id === e.from);
          return n.kind === "raw"
            ? `<p>${link("lake", rawName(n))} <span class="quiet">${esc(t("nguồn dbt đã khai báo", "declared dbt source"))}</span></p>`
            : n.kind === "missing"
              ? `<p><span class="mono">${esc(n.name)}</span> <span class="marker-missing">◇ ${esc(t("Phụ thuộc bị thiếu: mô hình không còn tồn tại", "Missing dependency: the model no longer exists"))}</span></p>`
              : `<p>${link("model/" + n.id, n.id)} <span class="quiet">ref</span></p>`;
        })
        .join("");
      panel = `<div class="inner-grid"><section class="panel"><h2>${esc(t("Đầu vào đã khai báo", "Declared inputs"))}</h2>${m.declares.dynamic ? `<p class="marker-undeclared">? ${esc(t("Thượng nguồn chưa khai báo: SQL dùng tham chiếu động hoặc gọi thẳng bảng thô. Không đoán quan hệ nào.", "Upstream not declared: the SQL uses a dynamic reference or names a raw table directly. No relation is guessed."))}</p>` : ""}${inputs || (m.declares.dynamic ? "" : esc(t("Không khai báo ref hay nguồn dbt nào.", "Declares no ref and no dbt source.")))}</section><section class="panel"><h2>${esc(t("Được ref bởi", "Referenced by"))}</h2>${
        edges
          .filter((e) => e.from === name)
          .map((e) => `<p>${link("model/" + e.to, e.to)}</p>`)
          .join("") || "—"
      }</section></div>`;
    }
    return frame(
      "models",
      name,
      t(
        "Lưu định nghĩa trước khi dựng. Lưu không tự chạy mô hình.",
        "Save the definition before building. Saving does not execute the model.",
      ),
      `${crumbs([
        ["models", t("Mô hình", "Models")],
        [null, name],
      ])}<div class="fact-grid">${fact(t("Lần dựng gần nhất", "Last build"), buildStatus(m.status))}${fact(t("Bản SQL", "SQL definition"), `<span id="draft-status">${esc(dirty ? t("Có thay đổi chưa lưu", "Unsaved changes") : t("Đã lưu", "Saved"))}</span>`)}${fact(t("Lần dựng", "Build run"), m.lastRun ? link("journal/" + m.lastRun, m.lastRun) : "—")}${fact(t("Số cột dựng được", "Built columns"), m.columns ?? "—")}</div><div class="actions">${button("model-build", t("Dựng bản đã lưu (mô phỏng)", "Build saved version (simulate)"), true, !admin() || dirty || m.status === "running" || pending, `data-id="${name}"`)}${link("models", t("Xem thượng nguồn", "Open upstream lineage"), { view: "graph", node: name }, "plate")}</div><p id="build-help" class="quiet">${esc(dirty ? t("Cần lưu hoặc bỏ bản nháp trước khi dựng.", "Save or discard the draft before building.") : t("SQL và kiểm thử chỉ được giả lập trong bản duyệt.", "SQL execution and tests are simulated in this review."))}</p>${tabs(
        "model/" + name,
        [
          ["sql", "SQL"],
          ["tests", t("Kiểm thử", "Tests")],
          ["preview", t("Dữ liệu mẫu", "Preview")],
          ["references", t("Phụ thuộc", "Dependencies")],
          ["history", t("Lịch sử dựng", "Build history")],
        ],
        view,
      )}${panel}<div class="detail-band">${admin() ? button("model-delete", t("Xóa mô hình…", "Delete model…"), false, pending, `data-id="${name}"`) : ""}<p class="quiet">${esc(t("Xóa bị từ chối khi đang dựng. Mô hình nào ref mô hình này vẫn giữ ref, và dòng dữ liệu hiện nó là phụ thuộc bị thiếu.", "Deletion is refused while a build is running. Models that ref this one keep the ref, and lineage shows it as a missing dependency."))}</p></div>`,
    );
  }
  function testPanel(model, draft, dirty) {
    const rows = Object.entries(draft.tests.columns)
      .map(
        ([column, kinds]) =>
          `<fieldset class="choices"><legend>${esc(column)}</legend><div class="choice-grid">${["not_null", "unique"].map((kind) => `<label class="choice"><input type="checkbox" name="test:${esc(column)}" value="${kind}" ${kinds.includes(kind) ? "checked" : ""} ${!admin() ? "disabled" : ""}><span class="mono">${kind}</span></label>`).join("")}</div>${button("model-test-remove", t("Bỏ cột kiểm thử", "Remove test column"), false, !admin(), `data-id="${model.name}:${column}"`)}</fieldset>`,
      )
      .join("");
    return `<p class="prose">${esc(t("Giữ đúng hai loại kiểm thử đang được hỗ trợ: không rỗng và duy nhất. Không nhận YAML tùy ý.", "Keep the two supported test types: not-null and unique. Arbitrary YAML is not accepted."))}</p><form data-form="model-save" data-id="${model.name}">${rows || "<p>—</p>"}<div class="actions">${submit(t("Lưu bản nháp (mô phỏng)", "Save draft (simulate)"), !admin() || !dirty)}${button("model-discard", t("Bỏ thay đổi", "Discard draft"), false, !dirty, `data-id="${model.name}"`)}</div></form>${admin() ? `<form class="filters" data-form="model-test-add" data-id="${model.name}">${field(t("Tên cột thêm kiểm thử", "Column to test"), input("column", "", "id", 'required pattern="[a-z][a-z0-9_]{0,62}" maxlength="63"'))}<div class="actions">${submit(t("Thêm cột vào bản nháp", "Add column to draft"))}</div></form>` : ""}`;
  }
  function newModelPage() {
    return frame(
      "models",
      t("Tạo mô hình", "Create model"),
      t(
        "Tạo định nghĩa mới; chưa có dữ liệu cho đến khi dựng thành công.",
        "Create a definition; no data is available until a successful build.",
      ),
      `${crumbs([
        ["models", t("Mô hình", "Models")],
        [null, t("Tạo mới", "Create")],
      ])}${!admin() ? guard() : `<form data-form="model-new">${field(t("Tên mô hình", "Model name"), input("name", createDraft.name, t("Ví dụ: demo_summary", "Example: demo_summary"), 'required pattern="[a-z][a-z0-9_]{0,62}" maxlength="63"'))}<p class="quiet">${esc(t("Chữ thường, số và dấu gạch dưới; bắt đầu bằng chữ. Tên không trùng.", "Lowercase letters, numbers and underscores; start with a letter. Name must be unique."))}</p>${field("SQL", `<textarea class="editor" name="sql" rows="7" required spellcheck="false">${esc(createDraft.sql)}</textarea>`)}<div class="actions">${submit(t("Tạo bản nháp (mô phỏng)", "Create definition (simulate)"))}${button("create-cancel", t("Hủy", "Cancel"))}</div></form>`}`,
    );
  }
  function missing(section) {
    return frame(
      section,
      t("Không tìm thấy", "Not found"),
      t(
        "Liên kết không tồn tại trong bộ dữ liệu mẫu hiện tại.",
        "This link does not exist in the current fixture.",
      ),
      link(section, t("Về danh sách", "Back to list"), {}, "plate"),
    );
  }
  const rawName = (n) => t("Hồ thô: ", "Raw lake: ") + n.table;
  const nodeName = (n) =>
    n.kind === "raw" ? rawName(n) : n.kind === "missing" ? n.name : n.id;
  function nodeMarks(n) {
    if (n.kind === "raw")
      return `<span class="status">▭ ${esc(t("Nguồn dbt đã khai báo", "Declared dbt source"))}</span>`;
    if (n.kind === "missing")
      return `<span class="status marker-missing">◇ ${esc(t("Phụ thuộc bị thiếu", "Missing dependency"))}</span>`;
    return `${buildStatus(n.state)}${n.undeclared ? `<span class="status marker-undeclared">? ${esc(t("Thượng nguồn chưa khai báo", "Upstream not declared"))}</span>` : ""}`;
  }
  /*
   * Lineage inside the Models division. Only declared relations: ref (model → model) and
   * declared dbt source (raw lake table → model). Selecting a model highlights its whole
   * upstream chain and dims every other node, downstream included.
   */
  function graphView() {
    const { nodes, edges } = D.graph(db.models),
      p = current.params,
      selected = nodes.find((n) => n.id === p.node && n.kind === "model"),
      chain = selected ? D.upstream(selected.id, edges) : null;
    const cls = (n) =>
      [
        n.kind,
        n.undeclared ? "undeclared" : "",
        n.id === selected?.id ? "selected" : "",
        chain && chain.has(n.id) && n.id !== selected.id ? "upstream" : "",
        chain && !chain.has(n.id) ? "dimmed" : "",
      ].join(" ");
    const hrefFor = (n) =>
      n.kind === "raw"
        ? url("lake")
        : n.kind === "model"
          ? url("models", { view: "graph", node: n.id })
          : null;
    const labels = [
      t("Hồ thô · nguồn dbt đã khai báo", "Raw lake · declared dbt sources"),
      t("Tầng 1", "Level 1"),
      t("Tầng 2", "Level 2"),
      t("Tầng 3 trở lên", "Level 3 and beyond"),
    ];
    const pathItem = (id) => {
      const n = nodes.find((item) => item.id === id);
      if (n.kind === "missing")
        return `<span class="mono">${esc(n.name)}</span> <span class="marker-missing">◇ ${esc(t("phụ thuộc bị thiếu", "missing dependency"))}</span>`;
      const a = `<a class="text-link" href="${esc(hrefFor(n))}">${esc(nodeName(n))}</a>`;
      return n.undeclared
        ? `${a} <span class="marker-undeclared">? ${esc(t("thượng nguồn chưa khai báo", "upstream not declared"))}</span>`
        : a;
    };
    const paths = selected ? D.pathsTo(selected.id, edges) : [];
    const missingUp = selected
      ? nodes.filter((n) => n.kind === "missing" && chain.has(n.id))
      : [];
    const undeclaredUp = selected
      ? nodes.filter((n) => n.undeclared && chain.has(n.id))
      : [];
    const chainNames = selected
      ? nodes
          .filter((n) => chain.has(n.id) && n.id !== selected.id)
          .sort((a, b) => b.col - a.col)
      : [];
    const nodeLink = (n) => {
      const inner = `<span class="mono">${esc(nodeName(n))}</span>${nodeMarks(n)}`;
      const href = hrefFor(n);
      return href
        ? `<a href="${esc(href)}" data-node="${esc(n.id)}" class="graph-node ${cls(n)}" ${n.id === selected?.id ? 'aria-current="true"' : ""}>${inner}</a>`
        : `<div data-node="${esc(n.id)}" class="graph-node ${cls(n)}">${inner}</div>`;
    };
    const mobileNode = (n) => {
      const inner = `<span class="mono">${esc(nodeName(n))}</span>${nodeMarks(n)}`;
      const href = hrefFor(n);
      return href
        ? `<a class="mobile-node ${cls(n)}" href="${esc(href)}" ${n.id === selected?.id ? 'aria-current="true"' : ""}>${inner}</a>`
        : `<div class="mobile-node ${cls(n)}">${inner}</div>`;
    };
    return `<p class="graph-note">${esc(t("Chọn một mô hình để tô toàn bộ chuỗi thượng nguồn của nó; mọi nút khác, kể cả hạ nguồn, bị làm mờ. Chỉ vẽ quan hệ đọc từ khai báo của chính các mô hình: ref giữa hai mô hình, và bảng hồ thô được khai báo làm nguồn dbt. Không suy từ tên giống nhau, bộ lọc hay dữ liệu, nên không có nút tài khoản nguồn hay báo cáo.", "Select a model to highlight its whole upstream chain; every other node, downstream included, is dimmed. Only relations read from the models' own declarations are drawn: a ref between two models, and a raw lake table declared as a dbt source. Nothing is inferred from similar names, filters or data, so no source account or report appears."))}</p><form class="graph-tools" data-form="graph-select">${field(t("Chọn mô hình", "Select a model"), select("node", [["", t("Không chọn (toàn bộ sơ đồ)", "None (full map)")], ...nodes.filter((n) => n.kind === "model").map((n) => [n.id, n.id])], selected?.id || ""))}<div class="actions">${submit(t("Tô thượng nguồn", "Highlight upstream"))}${selected ? link("models", t("Bỏ chọn", "Clear selection"), { view: "graph" }, "plate") : ""}</div></form><div class="graph-legend"><span class="legend-rule">${esc(t("ref hoặc nguồn dbt đã khai báo", "Declared ref or dbt source"))}</span><span class="legend-rule dashed">${esc(t("Ref tới mô hình không còn", "Ref to a model that no longer exists"))}</span><span>? ${esc(t("Thượng nguồn chưa khai báo: không vẽ cạnh đoán", "Upstream not declared: no guessed edge"))}</span><span>${selected ? `${chain.size} / ${nodes.length} ${esc(t("nút thuộc chuỗi thượng nguồn; còn lại bị làm mờ", "nodes on the upstream chain; the rest dimmed"))}` : `${nodes.length} ${esc(t("nút", "nodes"))}`}</span></div><div class="graph-surface" role="region" aria-label="${esc(t("Sơ đồ thượng nguồn; đường đi dạng chữ ở phía dưới", "Upstream map; text paths below"))}" tabindex="0"><div class="graph-heads" style="grid-template-columns:repeat(4,minmax(0,1fr))">${labels.map((label) => `<span>${esc(label)}</span>`).join("")}</div><div class="graph-canvas"><svg class="graph-svg" aria-hidden="true"></svg>${nodes.map(nodeLink).join("")}</div></div>${
      selected
        ? `<section class="node-context" aria-labelledby="chain-title"><div class="toolbar"><h2 id="chain-title">${esc(t("Thượng nguồn của", "Upstream of"))} <span class="mono">${esc(selected.id)}</span></h2>${link("model/" + selected.id, t("Mở mô hình →", "Open model →"), {}, "plate")}</div>${
            selected.undeclared
              ? notice(t("Thượng nguồn chưa khai báo: mô hình này dùng tham chiếu động, nên không đọc được đầu vào từ khai báo. Không vẽ cạnh đoán; không có cạnh không có nghĩa là không có đầu vào.", "Upstream not declared: this model uses a dynamic reference, so its inputs cannot be read from its declarations. No edge is guessed; having no edge does not mean it has no inputs."))
              : ""
          }${missingUp.length ? notice(t(`Phụ thuộc bị thiếu: ${missingUp.map((n) => n.name).join(", ")}. Một mô hình trong chuỗi ref mô hình không còn tồn tại; cạnh vẫn được giữ.`, `Missing dependency: ${missingUp.map((n) => n.name).join(", ")}. A model on this chain refs a model that no longer exists; the edge is kept.`)) : ""}${undeclaredUp.length && !selected.undeclared ? notice(t("Chuỗi có mô hình chưa khai báo thượng nguồn; phía trên nó không được vẽ.", "The chain includes a model whose upstream is not declared; nothing above it is drawn.")) : ""}<h3>${esc(t("Mọi tên trong chuỗi thượng nguồn", "Every name on the upstream chain"))} (${chainNames.length})</h3><ul class="chain-list">${chainNames.map((n) => `<li>${pathItem(n.id)}</li>`).join("") || `<li class="quiet">—</li>`}</ul><h3>${esc(t("Đường đi thượng nguồn", "Upstream paths"))}</h3>${
            paths.length && !(paths.length === 1 && paths[0].length === 1)
              ? `<ol class="path-list">${paths.map((path) => `<li>${path.map(pathItem).join(' <span aria-hidden="true">→</span> ')}</li>`).join("")}</ol>`
              : `<p class="quiet">—</p>`
          }</section>`
        : `<p class="quiet">${esc(t("Mỗi nút là một mô hình, một bảng hồ thô được khai báo làm nguồn dbt, hoặc một ref tới mô hình đã xóa. Chọn một mô hình để có đường thượng nguồn dạng chữ, dùng được bằng bàn phím và trình đọc màn hình.", "Each node is a model, a raw lake table declared as a dbt source, or a ref to a deleted model. Select a model for text paths that work with a keyboard and a screen reader."))}</p>`
    }<div class="graph-mobile">${labels
      .map(
        (label, col) =>
          `<h3>${esc(label)}</h3>${
            nodes
              .filter((n) => n.col === col)
              .map(mobileNode)
              .join("") || `<p class="quiet">—</p>`
          }`,
      )
      .join("")}</div>`;
  }
  function drawGraph() {
    if (observer) observer.disconnect();
    const canvas = document.querySelector(".graph-canvas");
    if (!canvas) return;
    const layout = () => {
      if (!canvas.isConnected || canvas.clientWidth === 0) return;
      const { nodes, edges } = D.graph(db.models),
        selected = nodes.find(
          (n) => n.id === current.params.node && n.kind === "model",
        ),
        chain = selected ? D.upstream(selected.id, edges) : null;
      const elements = [...canvas.querySelectorAll("[data-node]")];
      const width = canvas.clientWidth,
        gap = 46,
        nodeWidth = (width - 3 * gap) / 4,
        positions = new Map();
      for (let col = 0; col < 4; col++) {
        const parentY = (n) => {
          const parentPositions = edges
            .filter((e) => e.to === n.id && positions.has(e.from))
            .map((e) => positions.get(e.from).y);
          return parentPositions.length
            ? parentPositions.reduce((a, b) => a + b, 0) /
                parentPositions.length
            : 18;
        };
        const inColumn = nodes.filter((n) => n.col === col);
        if (col > 0) inColumn.sort((a, b) => parentY(a) - parentY(b));
        let nextY = 18;
        inColumn.forEach((n) => {
          const y = Math.max(nextY, parentY(n));
          positions.set(n.id, {
            x: col * (nodeWidth + gap),
            y,
            w: nodeWidth,
            h: 112,
          });
          nextY = y + 136;
        });
      }
      const bottom =
        Math.max(...[...positions.values()].map((p) => p.y + p.h)) + 50;
      canvas.style.height = bottom + "px";
      for (const el of elements) {
        const p = positions.get(el.dataset.node);
        Object.assign(el.style, {
          left: p.x + "px",
          top: p.y + "px",
          width: p.w + "px",
          height: p.h + "px",
        });
      }
      // Geometry comes from one layout pass; no per-edge DOM measurements.
      const svg = canvas.querySelector("svg");
      svg.setAttribute("viewBox", `0 0 ${width} ${bottom}`);
      svg.innerHTML =
        `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#56513f"/></marker></defs>` +
        edges
          .map((e) => {
            const a = positions.get(e.from),
              b = positions.get(e.to),
              x1 = a.x + a.w,
              y1 = a.y + a.h / 2,
              x2 = b.x,
              y2 = b.y + b.h / 2;
            const spansOccupiedColumn = [...positions.values()].some(
              (p) => p.x > x1 && p.x + p.w < x2,
            );
            const d = spansOccupiedColumn
              ? `M ${x1} ${y1} L ${x1 + 20} ${y1} L ${x1 + 20} ${bottom - 20} L ${x2 - 20} ${bottom - 20} L ${x2 - 20} ${y2} L ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + 23} ${y1}, ${x2 - 23} ${y2}, ${x2} ${y2}`;
            const onChain = chain && chain.has(e.to);
            return `<path d="${d}" class="graph-edge ${onChain ? "active" : chain ? "dimmed" : ""} ${e.missing ? "missing" : ""}" marker-end="url(#arrow)"/>`;
          })
          .join("");
    };
    observer = new ResizeObserver(() => requestAnimationFrame(layout));
    observer.observe(canvas);
    layout();
    document.fonts.ready.then(() => {
      if (canvas.isConnected) layout();
    });
  }
  function announce(textValue) {
    document.getElementById("announcement").textContent = textValue;
  }
  function go(path, params = {}) {
    const next = url(path, params);
    if (location.hash === next) {
      render();
      return;
    }
    history.pushState(null, "", next);
    handleNavigation();
  }
  const workspace = window.createWorkspace({
    t, esc, url, link, button, field, input, select, submit, stamp, fact, table, tabs, crumbs, frame, notice,
    role, admin, go, render, write,
    current: () => current,
    db: () => db,
    pending: () => pending,
    error: (value) => { error = value; },
    message: (value) => { message = value; messagePath = current.path; announce(value); },
  });
  function render() {
    current = D.route(location.hash);
    const tenantId = current.params.tenant || "CASE-0042";
    // Keep editor drafts and query results inside their original case book.
    Object.assign(tenantBooks.get(activeTenant), { createDraft, consoleSQL, consoleResult });
    if (!tenantBooks.has(tenantId)) tenantBooks.set(tenantId, {
      db: { sources: [], models: [], records: [], runs: [], edges: [] }, drafts: new Map(),
    });
    const tenantBook = tenantBooks.get(tenantId);
    ({ db, drafts } = tenantBook);
    createDraft = tenantBook.createDraft || { name: "", sql: "select 1 as id" };
    consoleSQL = tenantBook.consoleSQL || "SELECT source, entity, id FROM raw.records LIMIT 20;";
    consoleResult = tenantBook.consoleResult || null;
    activeTenant = tenantId;
    if (message && messagePath !== current.path) message = "";
    document.documentElement.lang = current.params.lang || "vi";
    const [section, id] = current.path.split("/");
    const pages = {
      sources: () => sourcesPage(),
      source: () => sourcesPage(id),
      scope: () => scopePage(id),
      schedule: () => schedulePage(id),
      journal: () => journalPage(id),
      lake: () => lakePage(id),
      models: modelsPage,
      model: () => modelPage(id),
      "model-new": newModelPage,
      ...workspace.pages(id),
    };
    try {
      shell.innerHTML = (pages[section] || (() => missing("sources")))();
      workspace.afterRender();
      if (pending)
        document
          .querySelectorAll(
            "form input,form select,form textarea,form button,[data-action]",
          )
          .forEach((el) => {
            el.disabled = true;
          });
      drawGraph();
      const rail = document.querySelector(".nav"),
        active = rail?.querySelector("[aria-current=page]");
      if (rail && active && window.innerWidth <= 760)
        rail.scrollLeft = Math.max(
          0,
          active.offsetLeft - rail.clientWidth / 2 + active.clientWidth / 2,
        );
      document.title =
        (document.querySelector("h1")?.textContent || "Undercroft") +
        " · UI review r5";
    } catch (cause) {
      shell.innerHTML = `<main class="leaf"><h1>${esc(t("Không thể hiển thị bản mẫu", "Unable to render prototype"))}</h1><p>${esc(cause.message)}</p><a href="#sources">${esc(t("Về nguồn dữ liệu", "Back to sources"))}</a></main>`;
      console.error(cause);
    }
  }
  async function write(operation, successText, destination, permitted = admin) {
    if (!permitted()) {
      error = t(
        "Vai trò hiện tại không có quyền ghi.",
        "The current role cannot write.",
      );
      render();
      return;
    }
    if (pending) return;
    const requestedTenant = current.params.tenant || "CASE-0042";
    const requestedRole = role();
    pending = true;
    error = "";
    message = "";
    const fail = scenario === "fail",
      delay = scenario === "slow" ? 1800 : 400;
    scenario = "normal";
    render();
    try {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (fail)
        throw new Error(
          t(
            "Lỗi kết nối giả lập. Bản nháp vẫn được giữ; có thể thử lưu lại.",
            "Simulated connection failure. The draft is retained; you can retry.",
          ),
        );
      if (!permitted() || requestedTenant !== (current.params.tenant || "CASE-0042") || requestedRole !== role())
        throw new Error(
          t(
            "Vai trò đã thay đổi. Không ghi thay đổi.",
            "Role changed. No changes were written.",
          ),
        );
      operation();
      message = successText;
      messagePath = destination || current.path;
      announce(successText);
    } catch (cause) {
      error =
        cause.message ||
        t("Có lỗi chưa xác định.", "An unexpected error occurred.");
    } finally {
      pending = false;
      if (!error && destination) go(destination);
      else render();
    }
  }
  function captureScope(form) {
    const source = db.sources.find((s) => s.id === form.dataset.id),
      fd = new FormData(form),
      draft = getScopeDraft(source);
    if (source.kind === "gmail") {
      draft.labels = fd.getAll("labels").map((id) => ({ id, name: id }));
      draft.fileTypes = fd.getAll("fileTypes");
    }
    if (source.kind === "xero") {
      draft.organisation = {
        id: fd.get("organisation"),
        name: "Demo Company Pte. Ltd.",
      };
      draft.entities = fd.getAll("entities");
    }
    if (source.kind === "hubspot")
      draft.properties = Object.fromEntries(
        ["contacts", "companies", "deals"].map((entity) => [
          entity,
          fd.getAll("prop:" + entity),
        ]),
      );
    if (source.kind === "drive") {
      const titles = {
        "folder-finance": "Demo finance",
        "folder-support": "Demo support",
        "file-handbook": "Sample handbook.pdf",
      };
      draft.files = fd.getAll("files").map((id) => ({
        id,
        name: titles[id],
        kind: id.startsWith("folder-") ? "folder" : "file",
      }));
      draft.recurse = fd.has("recurse");
      draft.fileTypes = fd.getAll("fileTypes");
    }
  }
  // No modals: a confirmation is a hinged leaf inside the page, which stays in the document
  // and the tab order above and below it.
  function openHinge(title, body, actions = "") {
    hinge = { title, body, actions, path: current.path };
    render();
    document.getElementById("hinge-title")?.focus();
  }
  const explain = (title, body) => openHinge(title, `<p>${esc(body)}</p>`);
  async function action(name, id) {
    if (await workspace.action(name, id)) return;
    const source = db.sources.find((s) => s.id === id),
      model = db.models.find((m) => m.name === id);
    if (name === "hinge-close") {
      hinge = null;
      render();
      return;
    }
    if (name === "account" || name === "assistant" || name === "logout") {
      explain(
        t("Điều khiển ngoài phạm vi bản mẫu", "Control outside this prototype"),
        t(
          "Giữ vị trí trong header gốc. Bản duyệt không có phiên đăng nhập thật, trợ lý hay tài khoản thật để thao tác.",
          "Its position in the original header is preserved. This offline review has no real login session, assistant or account to operate.",
        ),
      );
      return;
    }
    if (name === "reset") {
      openHinge(
        t("Khôi phục dữ liệu mẫu?", "Reset fixture data?"),
        `<p>${esc(t("Mọi bản nháp và thay đổi trong tab này sẽ mất. Không ảnh hưởng hệ thật.", "Drafts and changes in this tab will be discarded. Production is unaffected."))}</p>`,
        button("reset-confirm", t("Khôi phục", "Reset"), true),
      );
      return;
    }
    if (name === "create-cancel") {
      createDraft.name = "";
      createDraft.sql = "select 1 as id";
      go("models");
      return;
    }
    if (name === "reset-confirm") {
      workspace.clearDrafts();
      drafts.clear();
      location.reload();
      return;
    }
    if (name === "connect") {
      explain(
        t("Thêm kết nối", "Add connection"),
        t(
          "Luồng production tiếp tục dùng OAuth và callback có sẵn. Mẫu này không giả màn hình cấp quyền; dùng các tài khoản fixture để duyệt các màn sau kết nối.",
          "Production keeps its existing OAuth and callback flow. This review does not imitate a consent screen; use the fixture accounts to review post-connection screens.",
        ),
      );
      return;
    }
    if (name === "scope-cancel") {
      drafts.delete("scope:" + id);
      go("source/" + id);
      return;
    }
    if (name === "schedule-cancel") {
      drafts.delete("schedule:" + id);
      go("source/" + id);
      return;
    }
    if (name === "scope-save") {
      const effect = D.scopeEffect(source.kind, source.scope, getScopeDraft(source));
      await write(
        () => {
          source.scope = D.clone(getScopeDraft(source));
          if (source.status === "needs_scope") source.status = "connected";
          drafts.delete("scope:" + id);
        },
        t("Đã lưu phạm vi trong bản mẫu. ", "Scope saved in this prototype. ") +
          (effect.effect === "marked-removed-at-next-complete-read"
            ? t(
                "Lần đọc đầy đủ tiếp theo sẽ đánh dấu các mục ngoài lựa chọn mới là đã xóa ở nguồn; chúng vẫn nằm trong kho thô.",
                "The next complete read marks items outside the new pick as removed at source; they stay in the raw lake.",
              )
            : t(
                "Bản ghi đã có trong kho vẫn ở trạng thái hiện hành; không có gì bị xóa khỏi kho.",
                "Records already held stay live; nothing is erased from the lake.",
              )),
        "source/" + id,
      );
      return;
    }
    if (name === "reconnect") {
      await write(
        () => {
          source.status = "connected";
        },
        t(
          "Đã mô phỏng kết nối lại. Không có OAuth thật được thực hiện.",
          "Reconnection simulated. No real OAuth flow ran.",
        ),
      );
      return;
    }
    if (name === "read-source") {
      await write(
        () => {
          const runId = "CASE-" + String(2000 + db.runs.length);
          db.runs.unshift({
            id: runId,
            type: "read",
            target: id,
            status: "success",
            time: new Date().toISOString(),
            read: 0,
            written: 0,
            scopeAtStart: D.clone(source.scope),
            entities: [],
            error: null,
          });
        },
        t(
          "Đã thêm lần đọc mẫu: không có bản ghi mới.",
          "Added a simulated read with no new records.",
        ),
      );
      return;
    }
    if (name === "disconnect") {
      openHinge(
        t("Ngắt kết nối này?", "Disconnect this account?"),
        `<p>${esc(sourceLabel(id))}</p><p>${esc(t("Dữ liệu đã vào kho được giữ nguyên. Thao tác chỉ thay đổi fixture.", "Landed data is retained. Only the fixture changes."))}</p>`,
        button(
          "disconnect-confirm",
          t("Xác nhận ngắt (mô phỏng)", "Confirm disconnect (simulate)"),
          true,
          false,
          `data-id="${id}"`,
        ),
      );
      return;
    }
    if (name === "disconnect-confirm") {
      hinge = null;
      await write(
        () => {
          source.status = "needs_reconnect";
        },
        t(
          "Đã ngắt kết nối trong bản mẫu. Dữ liệu thô vẫn còn.",
          "Fixture connection disconnected. Raw data is retained.",
        ),
      );
      return;
    }
    if (name === "model-test-remove") {
      const [modelId, column] = id.split(":");
      delete getModelDraft(db.models.find((m) => m.name === modelId)).tests
        .columns[column];
      render();
      return;
    }
    if (name === "model-discard") {
      drafts.delete("model:" + id);
      messagePath = current.path;
      message = t(
        "Đã bỏ bản nháp, trở lại định nghĩa đã lưu.",
        "Draft discarded; restored saved definition.",
      );
      render();
      return;
    }
    if (name === "model-build") {
      if (isModelDirty(model) || model.status === "running") {
        error = t(
          "Cần lưu hoặc bỏ bản nháp; không dựng chồng lên lần đang chạy.",
          "Save or discard the draft; builds cannot overlap.",
        );
        render();
        return;
      }
      await write(
        () => {
          const runId = "CASE-" + String(2000 + db.runs.length);
          model.lastRun = runId;
          model.status = "success";
          model.columns = model.columns || 1;
          model.lastSuccess = new Date().toISOString();
          db.runs.unshift({
            id: runId,
            type: "build",
            target: id,
            status: "success",
            time: model.lastSuccess,
            read: 0,
            written: 3,
            scopeAtStart: undefined,
            entities: [],
            error: null,
          });
        },
        t(
          "Đã dựng mô phỏng bản đã lưu. Xem lần chạy mới trong lịch sử.",
          "Saved version built in simulation. Inspect the new history entry.",
        ),
      );
      return;
    }
    if (name === "model-delete") {
      openHinge(
        t("Xóa mô hình?", "Delete model?"),
        `<p class="mono">${esc(id)}</p><p>${esc(t("Bị từ chối nếu đang dựng. Mô hình nào ref nó sẽ hiện phụ thuộc bị thiếu. Lịch sử chạy vẫn giữ nguyên.", "Refused while a build is running. Models that ref it will show a missing dependency. Run history remains."))}</p>`,
        button(
          "model-delete-confirm",
          t("Xác nhận xóa (mô phỏng)", "Confirm deletion (simulate)"),
          true,
          false,
          `data-id="${id}"`,
        ),
      );
      return;
    }
    if (name === "model-delete-confirm") {
      hinge = null;
      await write(
        () => {
          if (!D.canDelete(model))
            throw new Error(
              t(
                "Không thể xóa: mô hình đang dựng. Không có gì bị xóa.",
                "Deletion refused: a build is running. Nothing was deleted.",
              ),
            );
          db.models = db.models.filter((m) => m.name !== id);
          drafts.delete("model:" + id);
        },
        t(
          "Đã xóa mô hình trong fixture. Mô hình nào ref nó vẫn giữ ref; dòng dữ liệu hiện đó là phụ thuộc bị thiếu. Tải lại để khôi phục.",
          "Model removed from the fixture. Models that ref it keep the ref; lineage shows it as a missing dependency. Reload to restore.",
        ),
        "models",
      );
      return;
    }
    if (name === "copy-record") {
      try {
        await navigator.clipboard.writeText(
          db.records.find((r) => r.id === id).payload,
        );
        messagePath = current.path;
        message = t(
          "Đã sao chép nguyên chuỗi payload.",
          "Original payload copied.",
        );
        render();
      } catch {
        explain(
          t("Trình duyệt chặn clipboard", "Clipboard access blocked"),
          t(
            "Có thể chọn nội dung trong khung payload và sao chép thủ công. Không có dữ liệu nào bị sửa.",
            "Select the payload text and copy it manually. No data was changed.",
          ),
        );
      }
      return;
    }
    if (name === "export-records") {
      if (!admin()) return;
      const { records } = lakeFilter(current.params);
      const blob = new Blob(
        [
          "\ufeff" +
            D.csv([
              ["id", "source", "entity", "payload"],
              ...records.map((r) => [r.id, r.source, r.entity, r.payload]),
            ]),
        ],
        { type: "text/csv;charset=utf-8" },
      );
      const objectURL = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = objectURL;
      a.download = "undercroft-synthetic-records.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
      announce(
        t(
          "Đã tạo CSV từ kết quả đang lọc.",
          "CSV generated from the filtered results.",
        ),
      );
      return;
    }
    if (name === "console-example") {
      consoleSQL = "SELECT source, entity, id FROM raw.records LIMIT 20;";
      error = "";
      render();
      return;
    }
  }
  document.addEventListener("click", (event) => {
    if (event.target.closest(".skip")) {
      event.preventDefault();
      document.getElementById("content")?.focus();
      return;
    }
    const target = event.target.closest("[data-action]");
    if (target && !target.disabled) {
      event.preventDefault();
      action(target.dataset.action, target.dataset.id).catch((cause) => {
        error = cause.message;
        render();
      });
      return;
    }
    const anchor = event.target.closest('a[href^="#"]');
    if (
      anchor &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.button === 0
    ) {
      event.preventDefault();
      const destination = anchor.getAttribute("href");
      if (destination !== location.hash) {
        history.pushState(null, "", destination);
        handleNavigation();
      }
    }
  });
  document.addEventListener("input", (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    workspace.capture(form);
    if (form.dataset.form === "scope") captureScope(form);
    if (form.dataset.form === "schedule") {
      const fd = new FormData(form);
      drafts.set("schedule:" + form.dataset.id, {
        cadence: fd.get("cadence"),
        resync: fd.get("resync"),
      });
    }
    if (form.dataset.form === "model-save") {
      const model = db.models.find((m) => m.name === form.dataset.id);
      const draft = getModelDraft(model);
      if (event.target.name.startsWith("test:")) {
        const column = event.target.name.slice(5);
        draft.tests.columns[column] = [
          ...new FormData(form).getAll("test:" + column),
        ].sort();
      } else draft[event.target.name] = event.target.value;
      const dirty = isModelDirty(model);
      form.querySelector("[type=submit]").disabled = !dirty || !admin();
      const build = document.querySelector("[data-action=model-build]");
      if (build)
        build.disabled = dirty || !admin() || model.status === "running";
      form.querySelector("[data-action=model-discard]").disabled = !dirty;
      document.getElementById("draft-status").textContent = dirty
        ? t("Có thay đổi chưa lưu", "Unsaved changes")
        : t("Đã lưu", "Saved");
      document.getElementById("build-help").textContent = dirty
        ? t(
            "Cần lưu hoặc bỏ bản nháp trước khi dựng.",
            "Save or discard the draft before building.",
          )
        : t("Dựng dùng định nghĩa đã lưu.", "Build uses the saved definition.");
    }
    if (form.dataset.form === "console") consoleSQL = event.target.value;
    if (form.dataset.form === "model-new")
      createDraft[event.target.name] = event.target.value;
  });
  document.addEventListener("change", (event) => {
    workspace.changed(event);
    if (event.target.name === "review-role") {
      error = "";
      message = "";
      go(current.path, { ...current.params, role: event.target.value });
    }
    if (event.target.name === "review-scenario") scenario = event.target.value;
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const fd = new FormData(form),
      values = Object.fromEntries(fd),
      id = form.dataset.id;
    error = "";
    message = "";
    switch (form.dataset.form) {
      default:
        await workspace.submitForm(form, values);
        break;
      case "source-filter":
        go("sources", values);
        break;
      case "journal-filter":
        go("journal", values);
        break;
      case "lake-filter":
        go("lake", {
          ...values,
          run: current.params.run,
          change: current.params.change,
        });
        break;
      case "model-filter":
        go("models", { ...values, view: "list" });
        break;
      case "graph-select":
        go("models", { view: "graph", node: values.node });
        break;
      case "scope":
        captureScope(form);
        go("scope/" + id, { step: "review" });
        break;
      case "schedule":
        await write(
          () => {
            const s = db.sources.find((s) => s.id === id);
            s.cadence = values.cadence;
            s.resync = values.resync;
            drafts.delete("schedule:" + id);
          },
          t("Đã lưu lịch trong bản mẫu.", "Schedule saved in the prototype."),
          "source/" + id,
        );
        break;
      case "model-test-add": {
        const m = db.models.find((m) => m.name === id),
          d = getModelDraft(m);
        if (
          /^[a-z][a-z0-9_]{0,62}$/.test(values.column) &&
          !Object.hasOwn(d.tests.columns, values.column)
        ) {
          d.tests.columns[values.column] = [];
        }
        render();
        break;
      }
      case "model-save":
        await write(
          () => {
            const m = db.models.find((m) => m.name === id),
              d = getModelDraft(m);
            m.sql = d.sql;
            m.declares = D.declarations(d.sql);
            m.tests = D.clone(d.tests);
            m.updatedAt = new Date().toISOString();
            drafts.delete("model:" + id);
          },
          t(
            "Đã lưu định nghĩa. Chưa chạy dựng.",
            "Definition saved. No build was started.",
          ),
        );
        break;
      case "model-new": {
        const reason = D.validateName(values.name, db.models);
        if (reason) {
          error =
            reason === "duplicate"
              ? t("Tên mô hình đã tồn tại.", "Model name already exists.")
              : t("Tên mô hình không hợp lệ.", "Invalid model name.");
          render();
          break;
        }
        await write(
          () => {
            db.models.push({
              name: values.name,
              sql: values.sql,
              tests: { columns: {} },
              declares: D.declarations(values.sql),
              status: "never",
              columns: null,
              lastRun: null,
              updatedAt: new Date().toISOString(),
              updatedBy: "operator@example.test",
            });
            createDraft.name = "";
            createDraft.sql = "select 1 as id";
          },
          t(
            "Đã tạo mô hình mẫu, chưa dựng.",
            "Fixture model created; it has never been built.",
          ),
          "model/" + values.name,
        );
        break;
      }
      case "console":
        consoleSQL = values.sql;
        if (!admin()) {
          error = t("Cần quyền quản trị.", "Administrator access required.");
          render();
          break;
        }
        if (
          consoleSQL
            .trim()
            .replace(/;$/, "")
            .replace(/\s+/g, " ")
            .toLowerCase() !==
          "select source, entity, id from raw.records limit 20"
        ) {
          consoleResult = null;
          error = t(
            "Bản mẫu chỉ hỗ trợ câu SELECT mẫu. Chưa gửi truy vấn đi đâu.",
            "This prototype only supports the sample SELECT. No query was sent anywhere.",
          );
        } else consoleResult = db.records.slice(0, 20);
        render();
        break;
    }
  });
  function hasUnsaved() {
    if (workspace.hasUnsaved()) return true;
    if (createDraft.name || createDraft.sql !== "select 1 as id") return true;
    for (const [key, value] of drafts) {
      const [type, id] = key.split(":");
      if (type === "model") {
        const m = db.models.find((m) => m.name === id);
        if (m && isModelDirty(m)) return true;
      } else {
        const s = db.sources.find((s) => s.id === id);
        if (
          s &&
          JSON.stringify(value) !==
            JSON.stringify(
              type === "scope"
                ? s.scope || D.emptyScope(s.kind)
                : { cadence: s.cadence, resync: s.resync },
            )
        )
          return true;
      }
    }
    return false;
  }
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsaved()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  function handleNavigation() {
    const previous = D.href(current.path, current.params),
      next = D.route(location.hash),
      sameView =
        next.path === current.path && next.params.view === current.params.view;
    // Back can emit both popstate and hashchange. Only the first owns rendering.
    if (previous === D.href(next.path, next.params)) return;
    scrollPositions.set(previous, window.scrollY);
    const scrollTarget =
      scrollPositions.get(D.href(next.path, next.params)) ??
      (sameView ? window.scrollY : 0);
    error = "";
    if (hinge && hinge.path !== next.path) hinge = null;
    render();
    document.getElementById("content")?.focus({ preventScroll: true });
    window.scrollTo({ top: scrollTarget, behavior: "instant" });
  }
  window.addEventListener("hashchange", handleNavigation);
  window.addEventListener("popstate", handleNavigation);
  window.addEventListener("resize", () => {
    const rail = document.querySelector(".nav"), active = rail?.querySelector("[aria-current=page]");
    if (rail && active && window.innerWidth <= 760)
      rail.scrollLeft = Math.max(0, active.offsetLeft - rail.clientWidth / 2 + active.clientWidth / 2);
  });
  render();
})();
