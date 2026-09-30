(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReviewDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const xeroEntities = [
    "accounts",
    "bank_transactions",
    "bank_transfers",
    "batch_payments",
    "contact_groups",
    "contacts",
    "credit_notes",
    "currencies",
    "invoices",
    "items",
    "linked_transactions",
    "manual_journals",
    "overpayments",
    "payments",
    "prepayments",
    "purchase_orders",
    "quotes",
    "repeating_invoices",
    "tax_rates",
    "tracking_categories",
  ];
  /** The last-build states the Models list marks. "never" = no build recorded. */
  const buildStates = ["error", "skipped", "never", "success"];
  /** The two raw lake tables a model may declare as a dbt source. */
  const rawTables = ["records", "documents"];
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /*
   * Model fixtures. `declares` stands in for what the server reads from each model's own
   * declarations (dbt refs and sources). The SQL text is written to match it; a test holds
   * the two together. Nothing here is inferred from names, filters or data.
   */
  const modelFixtures = [
    ["customer_health_daily", "error", { refs: ["dim_customer", "ar_open_items"] }],
    ["orders_daily", "success", { refs: ["stg_orders"] }],
    ["revenue_monthly", "success", { refs: ["orders_daily", "payment_summary"] }],
    ["refund_reasons", "never", { refs: ["stg_document_text"] }],
    ["stg_customers", "success", { sources: ["records"], filter: "contacts" }],
    ["stg_orders", "success", { sources: ["records"], filter: "deals" }],
    ["stg_xero_invoices", "success", { sources: ["records"], filter: "invoices" }],
    ["stg_document_text", "skipped", { sources: ["documents"], filter: "documents" }],
    ["dim_customer", "success", { refs: ["stg_customers"] }],
    ["ar_open_items", "success", { refs: ["stg_xero_invoices"] }],
    ["stg_payments", "success", { sources: ["records"], filter: "payments" }],
    ["payment_summary", "success", { refs: ["stg_payments"] }],
    // Upstream cannot be read from its declarations: the ref target is a variable.
    ["legacy_rollup", "success", { dynamic: true }],
    // Refs a model that was deleted; the ref stays and shows as a missing dependency.
    ["churn_watch", "error", { refs: ["dim_customer", "stg_churn_signals"] }],
  ];
  function fixtureSQL(name, d) {
    const head = "-- Synthetic review fixture; save before building.\n";
    if (d.dynamic)
      return `${head}-- The target is chosen at compile time, so no upstream is declared.\nselect *\nfrom {{ ref(var('rollup_target')) }}\n`;
    if (d.sources)
      return `${head}select *\nfrom {{ source('undercroft', '${d.sources[0]}') }}\nwhere entity = '${d.filter}'\n`;
    const [first, ...rest] = d.refs;
    return `${head}select *\nfrom {{ ref('${first}') }}\n${rest.map((r) => `join {{ ref('${r}') }} using (id)\n`).join("")}`;
  }

  /*
   * The relations a model's SQL declares, read the way dbt reads them: a literal
   * {{ ref('name') }} or {{ source('undercroft', 'records'|'documents') }}. Anything else that
   * picks its input at compile time (a ref or source with a non-literal argument), or a raw
   * table named directly, makes the upstream "not declared". Nothing is guessed from names.
   * This stands in for the dbt manifest the server would read; it is not a SQL parser.
   */
  function declarations(sql) {
    const text = String(sql || "").replace(/--[^\n]*/g, "");
    const refs = [],
      sources = [];
    let dynamic = false;
    for (const m of text.matchAll(/\{\{\s*ref\(([^)]*)\)/g)) {
      const lit = m[1].match(/^\s*['"]([a-z][a-z0-9_]*)['"]\s*$/);
      if (lit) refs.push(lit[1]);
      else dynamic = true;
    }
    for (const m of text.matchAll(/\{\{\s*source\(([^)]*)\)/g)) {
      const lit = m[1].match(
        /^\s*['"]undercroft['"]\s*,\s*['"](records|documents)['"]\s*$/,
      );
      if (lit) sources.push(lit[1]);
      else dynamic = true;
    }
    if (/\braw\.(records|documents)\b/i.test(text)) dynamic = true;
    return { refs: [...new Set(refs)], sources: [...new Set(sources)], dynamic };
  }
  function seed() {
    const sources = [
      {
        id: "xero.demo",
        kind: "xero",
        name: "Xero",
        account: "Demo Company Pte. Ltd.",
        status: "connected",
        scope: {
          kind: "xero",
          organisation: { id: "demo-org", name: "Demo Company Pte. Ltd." },
          entities: ["invoices", "contacts", "payments"],
        },
        cadence: "6h",
        resync: "30d",
      },
      {
        id: "hubspot.demo",
        kind: "hubspot",
        name: "HubSpot",
        account: "Demo sales workspace",
        status: "connected",
        scope: {
          kind: "hubspot",
          properties: { contacts: ["jobtitle"], companies: [], deals: [] },
        },
        cadence: "1h",
        resync: "30d",
      },
      {
        id: "gmail.operations",
        kind: "gmail",
        name: "Gmail",
        account: "operations@example.test",
        status: "connected",
        scope: {
          kind: "gmail",
          labels: [
            { id: "INBOX", name: "INBOX" },
            { id: "FINANCE", name: "FINANCE" },
          ],
          fileTypes: ["application/pdf"],
        },
        cadence: "6h",
        resync: "30d",
      },
      {
        id: "gmail.support",
        kind: "gmail",
        name: "Gmail",
        account: "support@example.test",
        status: "needs_reconnect",
        scope: {
          kind: "gmail",
          labels: [{ id: "SUPPORT", name: "SUPPORT" }],
          fileTypes: ["application/pdf"],
        },
        cadence: "6h",
        resync: "30d",
      },
      {
        id: "drive.finance",
        kind: "drive",
        name: "Google Drive",
        account: "finance@example.test",
        status: "connected",
        scope: {
          kind: "drive",
          files: [
            { id: "folder-finance", name: "Demo finance", kind: "folder" },
            { id: "folder-support", name: "Demo support", kind: "folder" },
          ],
          recurse: true,
          fileTypes: ["application/pdf"],
        },
        cadence: "6h",
        resync: "30d",
      },
      {
        id: "drive.knowledge",
        kind: "drive",
        name: "Google Drive",
        account: "knowledge@example.test",
        status: "connected",
        scope: {
          kind: "drive",
          files: [
            { id: "folder-support", name: "Demo support", kind: "folder" },
          ],
          recurse: false,
          fileTypes: [],
        },
        cadence: "24h",
        resync: "30d",
      },
      {
        id: "drive.archive",
        kind: "drive",
        name: "Google Drive",
        account: "archive@example.test",
        status: "needs_scope",
        scope: null,
        cadence: "24h",
        resync: "30d",
      },
    ];
    const models = modelFixtures.map(([name, status, declares], i) => ({
      name,
      status,
      declares: declarations(fixtureSQL(name, declares)),
      columns: status === "never" ? null : 12 + i,
      updatedAt: `2026-09-${String(28 - (i % 3)).padStart(2, "0")}T08:00:00Z`,
      updatedBy: "operator@example.test",
      lastRun:
        status === "never" ? null : `CASE-${String(i + 42).padStart(4, "0")}`,
      lastSuccess: ["never", "skipped", "error"].includes(status)
        ? null
        : "2026-09-29T08:40:00Z",
      recovered: name === "orders_daily",
      sql: fixtureSQL(name, declares),
      tests: { columns: { id: ["not_null"] } },
    }));
    /*
     * Each record lists the runs that wrote it, oldest first. The last write is the run the
     * record is attributed to now; an earlier run that wrote it counts it as "now attributed
     * to a later run".
     */
    const records = [
      {
        id: "REC-001",
        source: "xero.demo",
        entity: "invoices",
        landedAt: "2026-09-29T08:39:00Z",
        writes: [{ run: "CASE-0101", change: "created" }],
        payload:
          '{\n  "InvoiceID": 9223372036854775807,\n  "InvoiceNumber": "DEMO-0001",\n  "Total": 1234.567890123456789,\n  "Status": "AUTHORISED"\n}',
      },
      {
        id: "REC-002",
        source: "xero.demo",
        entity: "invoices",
        landedAt: "2026-09-29T09:10:00Z",
        writes: [
          { run: "CASE-0101", change: "created" },
          { run: "CASE-0107", change: "changed" },
        ],
        payload:
          '{\n  "InvoiceNumber": "DEMO-0002",\n  "Total": 42.50,\n  "Status": "PAID"\n}',
      },
      {
        id: "REC-003",
        source: "xero.demo",
        entity: "contacts",
        landedAt: "2026-09-29T08:39:04Z",
        writes: [{ run: "CASE-0101", change: "created" }],
        payload: '{"ContactID":"DEMO-C1","Name":"Example Company"}',
      },
      {
        id: "REC-004",
        source: "hubspot.demo",
        entity: "contacts",
        landedAt: "2026-09-29T08:30:00Z",
        writes: [{ run: "CASE-0102", change: "created" }],
        payload:
          '{"id":"DEMO-H1","properties":{"email":"customer@example.test","jobtitle":"Example role"}}',
      },
      {
        id: "REC-005",
        source: "gmail.operations",
        entity: "documents",
        landedAt: "2026-09-29T08:20:00Z",
        writes: [{ run: "CASE-0103", change: "created" }],
        payload:
          '{"id":"DEMO-M1","subject":"Example invoice","attachment":"sample.pdf"}',
      },
      {
        id: "REC-006",
        source: "drive.finance",
        entity: "documents",
        landedAt: "2026-09-29T08:10:00Z",
        writes: [{ run: "CASE-0104", change: "created" }],
        payload:
          '{"id":"DEMO-D1","name":"Sample report.pdf","mimeType":"application/pdf"}',
      },
      {
        id: "REC-007",
        source: "drive.knowledge",
        entity: "documents",
        landedAt: "2026-09-29T08:05:00Z",
        writes: [{ run: "CASE-0105", change: "created" }],
        payload:
          '{"id":"DEMO-D2","name":"Sample support guide","mimeType":"text/plain"}',
      },
    ].map((r) => ({ ...r, run: r.writes[r.writes.length - 1].run }));
    const runs = models
      .filter((m) => m.lastRun)
      .map((m, i) => ({
        id: m.lastRun,
        type: "build",
        target: m.name,
        status: m.status,
        time: `2026-09-29T08:${String(50 - i).padStart(2, "0")}:00Z`,
        read: 0,
        written: m.status === "success" ? 10 + i : 0,
        scopeAtStart: undefined,
        entities: [],
        error:
          m.status === "error"
            ? m.name === "churn_watch"
              ? "Model stg_churn_signals, which this model refs, was not found."
              : "Column customer_id was not found in the saved SQL."
            : m.status === "skipped"
              ? "An upstream document extraction is incomplete."
              : null,
      }));
    const scopeOf = (id) => clone(sources.find((s) => s.id === id).scope);
    const readRun = (id, target, time, entities, extra = {}) => ({
      id,
      type: "read",
      target,
      status: "success",
      time,
      read: entities.reduce((n, e) => n + e.created + e.changed, 0),
      written: entities.reduce((n, e) => n + e.created + e.changed, 0),
      scopeAtStart: scopeOf(target),
      entities,
      error: null,
      ...extra,
    });
    runs.push(
      // Recorded before runs kept their scope: shows an em dash, never today's scope.
      readRun("CASE-0100", "drive.finance", "2026-09-20T08:10:00Z", [], {
        scopeAtStart: null,
        read: 1,
      }),
      readRun("CASE-0101", "xero.demo", "2026-09-29T08:39:00Z", [
        { entity: "invoices", created: 2, changed: 0 },
        { entity: "contacts", created: 1, changed: 0 },
      ]),
      readRun("CASE-0102", "hubspot.demo", "2026-09-29T08:30:00Z", [
        { entity: "contacts", created: 1, changed: 0 },
      ]),
      readRun("CASE-0103", "gmail.operations", "2026-09-29T08:20:00Z", [
        { entity: "documents", created: 1, changed: 0 },
      ]),
      readRun("CASE-0104", "drive.finance", "2026-09-29T08:10:00Z", [
        { entity: "documents", created: 1, changed: 0 },
      ]),
      readRun("CASE-0105", "drive.knowledge", "2026-09-29T08:05:00Z", [
        { entity: "documents", created: 1, changed: 0 },
      ]),
      {
        id: "CASE-0106",
        type: "read",
        target: "gmail.support",
        status: "error",
        time: "2026-09-29T08:00:00Z",
        read: 0,
        written: 0,
        scopeAtStart: scopeOf("gmail.support"),
        entities: [],
        error:
          "Demo connection needs authorization again. No new data was written.",
      },
      readRun("CASE-0107", "xero.demo", "2026-09-29T09:10:00Z", [
        { entity: "invoices", created: 0, changed: 1 },
      ]),
    );
    return { sources, models, records, runs };
  }
  function route(hash) {
    const [path, query = ""] = (hash || "#sources")
      .replace(/^#/, "")
      .split("?");
    return {
      path: path || "sources",
      params: Object.fromEntries(new URLSearchParams(query)),
    };
  }
  function href(path, params = {}) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "")
        p.set(key, String(value));
    });
    return "#" + path + (p.size ? "?" + p : "");
  }
  /** One count per last-build state the list marks; the states partition the list. */
  function counts(models) {
    return models.reduce(
      (result, m) => {
        result.all++;
        result[m.status] = (result[m.status] || 0) + 1;
        return result;
      },
      { all: 0, error: 0, skipped: 0, never: 0, success: 0 },
    );
  }
  /*
   * Lineage from declarations only. Nodes: the two raw lake tables and the models, plus one
   * node per ref whose model no longer exists. Edges: raw lake table → model where a model
   * declares it as a dbt source, and model → model where one model refs another. No source
   * account, report, question or dashboard is ever a node.
   */
  function graph(models) {
    const names = new Set(models.map((m) => m.name));
    // A raw lake table is drawn only when some model declares it; an empty book draws nothing.
    const declared = new Set(models.flatMap((m) => m.declares.sources));
    const nodes = rawTables
      .filter((table) => declared.has(table))
      .map((table) => ({ id: "raw:" + table, kind: "raw", table }));
    const edges = [],
      missing = new Set();
    for (const m of models) {
      nodes.push({
        id: m.name,
        kind: "model",
        undeclared: m.declares.dynamic,
        state: m.status,
      });
      for (const table of m.declares.sources)
        if (rawTables.includes(table))
          edges.push({ from: "raw:" + table, to: m.name, kind: "source" });
      for (const ref of m.declares.refs) {
        if (names.has(ref)) edges.push({ from: ref, to: m.name, kind: "ref" });
        else {
          missing.add(ref);
          edges.push({
            from: "missing:" + ref,
            to: m.name,
            kind: "ref",
            missing: true,
          });
        }
      }
    }
    for (const ref of missing)
      nodes.push({ id: "missing:" + ref, kind: "missing", name: ref });
    const depth = new Map();
    const depthOf = (id, trail = new Set()) => {
      if (depth.has(id)) return depth.get(id);
      const node = nodes.find((n) => n.id === id);
      if (node.kind === "raw") return 0;
      if (node.kind === "missing" || trail.has(id)) return 1;
      trail.add(id);
      const parents = edges.filter((e) => e.to === id);
      const d = parents.length
        ? 1 + Math.max(...parents.map((e) => depthOf(e.from, trail)))
        : 1;
      depth.set(id, d);
      return d;
    };
    for (const n of nodes) n.col = Math.min(3, depthOf(n.id));
    return { nodes, edges };
  }
  function walk(start, edges, direction) {
    const found = new Set([start]),
      queue = [start];
    while (queue.length) {
      const id = queue.shift();
      for (const e of edges) {
        const next =
          direction === "up"
            ? e.to === id
              ? e.from
              : null
            : e.from === id
              ? e.to
              : null;
        if (next && !found.has(next)) {
          found.add(next);
          queue.push(next);
        }
      }
    }
    return found;
  }
  /** The whole declared upstream chain of a node, the node included. Never downstream. */
  function upstream(start, edges) {
    return walk(start, edges, "up");
  }
  function pathsTo(id, edges, trail = []) {
    if (trail.includes(id)) return [];
    const parents = edges.filter((e) => e.to === id);
    if (!parents.length) return [[id]];
    return parents.flatMap((e) =>
      pathsTo(e.from, edges, [...trail, id]).map((path) => [...path, id]),
    );
  }
  function emptyScope(kind) {
    if (kind === "gmail") return { kind, labels: [], fileTypes: ["application/pdf"] };
    if (kind === "drive")
      return { kind, files: [], recurse: false, fileTypes: ["application/pdf"] };
    if (kind === "xero")
      return { kind, organisation: { id: "demo-org", name: "Demo Company Pte. Ltd." }, entities: [] };
    return { kind, properties: {} };
  }
  function scopeMeaning(kind, scope) {
    if (!scope)
      return {
        mode: kind === "hubspot" ? "spec-plus-properties" : "unconfigured",
        items: [],
      };
    if (kind === "gmail")
      return {
        mode: scope.labels.length ? "selected-labels" : "whole-mailbox",
        items: scope.labels.map((label) => label.name),
      };
    if (kind === "xero")
      return {
        mode: scope.entities.length ? "selected-entities" : "all-spec-entities",
        items: scope.entities.length ? scope.entities : xeroEntities,
      };
    if (kind === "drive")
      return {
        mode: scope.files.length ? "selected-files" : "no-files",
        items: scope.files.map((f) => f.name),
      };
    return {
      mode: "spec-plus-properties",
      items: Object.entries(scope.properties || {}).flatMap(([entity, props]) =>
        props.map((prop) => entity + "." + prop),
      ),
    };
  }
  /*
   * What a scope save does to records the lake already holds, by kind. Nothing is ever
   * erased from the lake:
   * - drive: a complete read lists the pick; held items it no longer names are marked
   *   removed at source (still in the lake, counted as deleted at source).
   * - gmail: a message that stops matching a label was relabelled, not deleted; it stays live.
   * - xero: an unticked entity is no longer read, so nothing lists its held records; they stay live.
   * - hubspot: the scope only adds properties; which records are read does not change, so held
   *   records stay live.
   */
  function scopeEffect(kind, saved, draft) {
    const before = scopeMeaning(kind, saved).items,
      after = new Set(scopeMeaning(kind, draft).items);
    const dropped = before.filter((item) => !after.has(item));
    if (kind === "drive") {
      const lostSubfolders = !!(saved && saved.recurse && draft && !draft.recurse);
      return { effect: "marked-removed-at-next-complete-read", dropped, lostSubfolders };
    }
    return { effect: "stay-live", dropped, lostSubfolders: false };
  }
  /** Which write plates a source card shows. For a role the server refuses, none at all. */
  function sourcePlates(status, role) {
    if (!canWrite(role)) return [];
    if (status === "not_connected") return ["connect"];
    if (status === "needs_scope") return ["choose-scope", "disconnect"];
    if (status === "needs_reconnect") return ["reconnect", "disconnect"];
    return ["run-now", "change-scope", "disconnect"];
  }
  /**
   * The records one run wrote for one entity and change. `current` are still attributed to
   * the run; `later` were rewritten since by a later run.
   */
  function runWrites(runId, entity, change, records) {
    const wrote = records.filter(
      (r) =>
        r.entity === entity &&
        r.writes.some((w) => w.run === runId && (!change || w.change === change)),
    );
    return {
      current: wrote.filter((r) => r.run === runId),
      later: wrote.filter((r) => r.run !== runId),
    };
  }
  function canWrite(role) {
    return role === "admin";
  }
  function canReadRaw(role) {
    return role === "admin";
  }
  function validateName(name, models) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) return "format";
    if (models.some((m) => m.name === name)) return "duplicate";
    return null;
  }
  /**
   * A model may be deleted unless a build is running. Models that ref it keep their ref;
   * lineage then shows it as a missing dependency.
   */
  function canDelete(model) {
    return model.status !== "running";
  }
  function streamKey(record) {
    return record.source + "::" + record.entity;
  }
  function csv(rows) {
    return rows
      .map((row) =>
        row
          .map((value) => '"' + String(value ?? "").replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\r\n");
  }
  return {
    seed,
    clone,
    xeroEntities,
    buildStates,
    rawTables,
    modelFixtures,
    declarations,
    route,
    href,
    counts,
    graph,
    walk,
    upstream,
    pathsTo,
    emptyScope,
    scopeMeaning,
    scopeEffect,
    sourcePlates,
    runWrites,
    canWrite,
    canReadRaw,
    validateName,
    canDelete,
    streamKey,
    csv,
  };
});
