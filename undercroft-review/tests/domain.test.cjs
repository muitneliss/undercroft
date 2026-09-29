const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../assets/domain.js");
const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/* ---------- Models list: one count per last-build state ---------- */

test("model summary has one count per last-build state and they add up to the list", () => {
  const models = D.seed().models,
    counts = D.counts(models);
  assert.deepEqual(D.buildStates, ["error", "skipped", "never", "success"]);
  assert.deepEqual(counts, {
    all: 14,
    error: 2,
    skipped: 1,
    never: 1,
    success: 10,
  });
  assert.equal(
    D.buildStates.reduce((n, s) => n + counts[s], 0),
    counts.all,
  );
  assert.equal(counts.all, models.length);
  for (const m of models) assert.ok(D.buildStates.includes(m.status), m.name);
});
test("counts still add up on a searched subset and after a new never-built model", () => {
  const models = D.seed().models,
    subset = models.filter((m) => m.name.includes("stg_")),
    c = D.counts(subset);
  assert.equal(
    D.buildStates.reduce((n, s) => n + c[s], 0),
    subset.length,
  );
  const more = [...models, { name: "demo_new", status: "never" }],
    c2 = D.counts(more);
  assert.equal(c2.never, 2);
  assert.equal(
    D.buildStates.reduce((n, s) => n + c2[s], 0),
    more.length,
  );
});
test("never built is its own state, not running and not new", () => {
  const app = read("assets/app.js");
  assert.doesNotMatch(app, /status: "idle"/);
  assert.doesNotMatch(app, /"New"\)|"Mới"/);
  assert.equal(D.seed().models.find((m) => m.name === "refund_reasons").lastRun, null);
});
test("route state survives Unicode and back/forward serialization", () => {
  for (const [p, state] of [
    ["models", { view: "list", status: "never", q: "hóa đơn & công nợ", lang: "vi", role: "member" }],
    ["journal", { source: "gmail.support", lang: "en", role: "admin" }],
    ["lake", { run: "CASE-0101", entity: "invoices", change: "created", role: "admin" }],
  ])
    assert.deepEqual(D.route(D.href(p, state)), { path: p, params: state });
});

/* ---------- Lineage: declared relations only ---------- */

test("lineage nodes are only models, the two raw lake tables and missing refs", () => {
  const db = D.seed(),
    { nodes } = D.graph(db.models);
  const sourceIds = new Set(db.sources.map((s) => s.id));
  for (const n of nodes) {
    assert.ok(["model", "raw", "missing"].includes(n.kind), n.id);
    assert.ok(!sourceIds.has(n.id), "source account node " + n.id);
    assert.doesNotMatch(n.id, /report|question|dashboard/);
  }
  assert.deepEqual(
    nodes.filter((n) => n.kind === "raw").map((n) => n.id),
    ["raw:records", "raw:documents"],
  );
});
test("lineage edges are only model → model (ref) and raw lake table → model (source)", () => {
  const { nodes, edges } = D.graph(D.seed().models),
    kind = (id) => nodes.find((n) => n.id === id).kind;
  for (const e of edges) {
    assert.equal(kind(e.to), "model");
    if (e.kind === "source") assert.equal(kind(e.from), "raw");
    else {
      assert.equal(e.kind, "ref");
      assert.ok(["model", "missing"].includes(kind(e.from)));
    }
  }
});
test("selecting a model highlights its whole upstream chain only, never downstream", () => {
  const { edges } = D.graph(D.seed().models);
  const up = D.upstream("dim_customer", edges);
  assert.deepEqual(new Set(up), new Set(["dim_customer", "stg_customers", "raw:records"]));
  assert.ok(!up.has("customer_health_daily"), "downstream must be dimmed");
  assert.ok(!up.has("churn_watch"), "downstream must be dimmed");
  assert.ok(!up.has("stg_orders"), "unrelated sibling must be dimmed");
  const deep = D.upstream("customer_health_daily", edges);
  assert.deepEqual(
    new Set(deep),
    new Set([
      "customer_health_daily",
      "dim_customer",
      "ar_open_items",
      "stg_customers",
      "stg_xero_invoices",
      "raw:records",
    ]),
  );
  assert.equal(D.pathsTo("customer_health_daily", edges).length, 2);
  for (const p of D.pathsTo("customer_health_daily", edges))
    assert.equal(p[0], "raw:records");
});
test("a model three levels deep has a readable text path from the raw lake", () => {
  const { nodes, edges } = D.graph(D.seed().models);
  assert.equal(nodes.find((n) => n.id === "customer_health_daily").col, 3);
  assert.ok(
    D.pathsTo("customer_health_daily", edges).some(
      (p) => p.join(">") === "raw:records>stg_customers>dim_customer>customer_health_daily",
    ),
  );
});
test("no edge is inferred from similar names, filters or a second mailbox", () => {
  const models = [
    ...D.seed().models,
    { name: "orders_daily_v2", status: "never", declares: D.declarations("select 1 as id") },
  ];
  const { edges } = D.graph(models);
  assert.ok(!edges.some((e) => [e.from, e.to].includes("orders_daily_v2")));
  // stg models filter on an entity; the filter never becomes an edge to a source account.
  assert.ok(!edges.some((e) => /\./.test(e.from)));
});
test("a dynamic reference is marked upstream not declared, with no guessed edge", () => {
  const db = D.seed(),
    { nodes, edges } = D.graph(db.models);
  const legacy = nodes.find((n) => n.id === "legacy_rollup");
  assert.equal(legacy.undeclared, true);
  assert.ok(!edges.some((e) => e.to === "legacy_rollup"));
  assert.equal(D.declarations("select * from {{ ref(var('t')) }}").dynamic, true);
  assert.equal(D.declarations("select * from raw.records").dynamic, true);
  assert.equal(D.declarations("select * from {{ ref('a') }}").dynamic, false);
  for (const n of nodes.filter((n) => n.kind === "model" && n.id !== "legacy_rollup"))
    assert.equal(n.undeclared, false, n.id);
});
test("a ref to a model that no longer exists is a missing dependency, edge kept", () => {
  const db = D.seed();
  let g = D.graph(db.models);
  assert.ok(g.nodes.some((n) => n.id === "missing:stg_churn_signals" && n.kind === "missing"));
  assert.ok(g.edges.some((e) => e.from === "missing:stg_churn_signals" && e.to === "churn_watch" && e.missing));
  assert.ok(D.upstream("churn_watch", g.edges).has("missing:stg_churn_signals"));
  // Deleting a referenced model keeps every edge from it, now as a missing dependency.
  const before = g.edges.filter((e) => e.from === "dim_customer").map((e) => e.to);
  assert.ok(D.canDelete(db.models.find((m) => m.name === "dim_customer")));
  g = D.graph(db.models.filter((m) => m.name !== "dim_customer"));
  const after = g.edges.filter((e) => e.from === "missing:dim_customer").map((e) => e.to);
  assert.deepEqual(after.sort(), before.sort());
  assert.ok(after.length >= 2);
});
test("fixture SQL agrees with the lineage it declares", () => {
  const db = D.seed();
  for (const [name, , intent] of D.modelFixtures) {
    const m = db.models.find((x) => x.name === name);
    assert.deepEqual(m.declares, {
      refs: intent.refs || [],
      sources: intent.sources || [],
      dynamic: !!intent.dynamic,
    }, name);
    if (name.startsWith("stg_"))
      assert.match(m.sql, /\{\{ source\('undercroft', '(records|documents)'\) \}\}/);
  }
});
test("cycle-safe traversal and path enumeration terminate", () => {
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
  ];
  assert.equal(D.upstream("a", edges).size, 2);
  assert.deepEqual(D.pathsTo("a", edges), []);
});
test("lineage stays inside Models: seven divisions, no modal, stepped motion", () => {
  const app = read("assets/app.js"),
    css = read("assets/review.css"),
    html = read("index.html");
  const nav = app.slice(app.indexOf("function frame("), app.indexOf("<div class=\"book\""));
  const divisions = nav.match(/\["(customers|sources|journal|lake|models|reports|people)"/g) || [];
  assert.equal(divisions.length, 7);
  assert.doesNotMatch(nav, /\["(lineage|graph)"/);
  const workspace = read("assets/workspace.js");
  assert.doesNotMatch(app + workspace, /showModal|<dialog/);
  assert.doesNotMatch(html, /<dialog/);
  for (const m of (css + read("assets/workspace.css")).matchAll(/(?:transition|animation)\s*:\s*([^;]+);/g)) {
    const v = m[1].trim();
    if (v === "none !important") continue;
    assert.ok(/var\(--(hinge|tip|turn|pass)\)|steps\(/.test(v), "unstepped motion: " + v);
  }
  for (const m of css.matchAll(/--(hinge|tip|turn|pass):\s*([^;]+);/g))
    assert.match(m[2], /steps\(/);
  assert.doesNotMatch(app, /Direct consumers|đúng tài khoản nguồn|exact source account/);
});

/* ---------- Scope: what happens to records already held ---------- */

test("scope save states the held-records effect per kind", () => {
  const db = D.seed(),
    src = (id) => db.sources.find((s) => s.id === id);
  const drive = src("drive.finance"),
    driveDraft = D.clone(drive.scope);
  driveDraft.files = driveDraft.files.filter((f) => f.id !== "folder-support");
  driveDraft.recurse = false;
  const d = D.scopeEffect("drive", drive.scope, driveDraft);
  assert.equal(d.effect, "marked-removed-at-next-complete-read");
  assert.deepEqual(d.dropped, ["Demo support"]);
  assert.equal(d.lostSubfolders, true);
  const gmail = src("gmail.operations"),
    gmailDraft = D.clone(gmail.scope);
  gmailDraft.labels = gmailDraft.labels.filter((l) => l.id !== "FINANCE");
  const g = D.scopeEffect("gmail", gmail.scope, gmailDraft);
  assert.equal(g.effect, "stay-live");
  assert.deepEqual(g.dropped, ["FINANCE"]);
  const xero = src("xero.demo"),
    xeroDraft = D.clone(xero.scope);
  xeroDraft.entities = ["invoices"];
  const x = D.scopeEffect("xero", xero.scope, xeroDraft);
  assert.equal(x.effect, "stay-live");
  assert.deepEqual(x.dropped.sort(), ["contacts", "payments"]);
  assert.equal(D.scopeEffect("hubspot", src("hubspot.demo").scope, { properties: {} }).effect, "stay-live");
  // A first pick on a source with no saved scope still gets a statement.
  assert.equal(D.scopeEffect("drive", null, D.emptyScope("drive")).effect, "marked-removed-at-next-complete-read");
});
test("no scope statement implies anything is erased from the lake", () => {
  const app = read("assets/app.js");
  const start = app.indexOf("function scopeEffectText("),
    body = app.slice(start, app.indexOf("function sourcePlates(", start));
  for (const kind of ["drive", "gmail", "xero", "hubspot"])
    assert.match(body, new RegExp(kind + ": t\\("));
  const en = [...body.matchAll(/"([^"]*lake[^"]*)"/g)].map((m) => m[1]);
  assert.ok(en.length >= 4);
  for (const line of en) assert.match(line, /nothing is erased from the lake|stay in the raw lake/);
  assert.doesNotMatch(body, /will be (deleted|erased)|are (deleted|erased) from the lake/);
});
test("empty Gmail labels mean whole mailbox; missing scope does not", () => {
  assert.equal(D.scopeMeaning("gmail", { labels: [] }).mode, "whole-mailbox");
  assert.equal(D.scopeMeaning("gmail", null).mode, "unconfigured");
});
test("empty Drive files mean no files", () => {
  assert.equal(D.scopeMeaning("drive", { files: [] }).mode, "no-files");
});
test("empty Xero selection means all twenty supported entities", () => {
  assert.equal(D.scopeMeaning("xero", { entities: [] }).items.length, 20);
});
test("empty HubSpot extras retain connector defaults", () => {
  assert.deepEqual(D.scopeMeaning("hubspot", { properties: {} }), {
    mode: "spec-plus-properties",
    items: [],
  });
  assert.deepEqual(D.scopeMeaning("hubspot", null), {
    mode: "spec-plus-properties",
    items: [],
  });
});

/* ---------- Sources: write plates absent for refused roles ---------- */

test("write plates are absent for member and viewer, state-driven for admin", () => {
  const states = ["not_connected", "needs_scope", "connected", "needs_reconnect"];
  for (const role of ["member", "viewer"])
    for (const s of states) assert.deepEqual(D.sourcePlates(s, role), [], role + " " + s);
  assert.deepEqual(D.sourcePlates("not_connected", "admin"), ["connect"]);
  assert.deepEqual(D.sourcePlates("needs_scope", "admin"), ["choose-scope", "disconnect"]);
  assert.deepEqual(D.sourcePlates("connected", "admin"), ["run-now", "change-scope", "disconnect"]);
  assert.deepEqual(D.sourcePlates("needs_reconnect", "admin"), ["reconnect", "disconnect"]);
  // The renderer never draws these plates disabled.
  const app = read("assets/app.js");
  assert.doesNotMatch(app, /button\("(connect|reconnect|disconnect|read-source)"[^)]*!admin\(\)/);
});

/* ---------- Journal and runs ---------- */

test("a run's counts lead to exactly the records it wrote, with later rewrites counted", () => {
  const db = D.seed();
  const w = D.runWrites("CASE-0101", "invoices", "created", db.records);
  assert.deepEqual(w.current.map((r) => r.id), ["REC-001"]);
  assert.deepEqual(w.later.map((r) => r.id), ["REC-002"]);
  assert.equal(w.later[0].run, "CASE-0107");
  for (const run of db.runs.filter((r) => r.type === "read"))
    for (const e of run.entities)
      for (const change of ["created", "changed"]) {
        const x = D.runWrites(run.id, e.entity, change, db.records);
        assert.equal(x.current.length + x.later.length, e[change], `${run.id} ${e.entity} ${change}`);
        for (const r of x.current) assert.equal(r.run, run.id);
      }
});
test("a run shows the scope it started with; an older run has none", () => {
  const db = D.seed();
  assert.equal(db.runs.find((r) => r.id === "CASE-0100").scopeAtStart, null);
  const run = db.runs.find((r) => r.id === "CASE-0104"),
    source = db.sources.find((s) => s.id === "drive.finance");
  assert.deepEqual(run.scopeAtStart, source.scope);
  source.scope.files = [];
  assert.equal(run.scopeAtStart.files.length, 2, "snapshot is not today's scope");
  const app = read("assets/app.js");
  assert.match(app, /r\.scopeAtStart === null[\s\S]{0,200}—/);
});
test("the Journal can be narrowed to one of two mailboxes", () => {
  const runs = D.seed().runs.filter((r) => r.target === "gmail.support");
  assert.deepEqual(runs.map((r) => r.id), ["CASE-0106"]);
});
test("members and viewers see counts as plain figures", () => {
  const app = read("assets/app.js");
  const start = app.indexOf("function runCounts("),
    body = app.slice(start, app.indexOf("function journalPage(", start));
  assert.match(body, /!D\.canReadRaw\(role\(\)\)\) return `<span class="mono">\$\{n\}<\/span>`/);
});

/* ---------- Carried over ---------- */

test("connection identity is part of stream key", () => {
  assert.notEqual(
    D.streamKey({ source: "gmail.operations", entity: "documents" }),
    D.streamKey({ source: "gmail.support", entity: "documents" }),
  );
});
test("raw payload preserves bigint and decimal lexemes", () => {
  const raw = D.seed().records[0].payload;
  assert.match(raw, /9223372036854775807/);
  assert.match(raw, /1234\.567890123456789/);
  assert.doesNotMatch(read("assets/app.js"), /JSON\.parse\([^)]*payload/);
});
test("members cannot mutate or read raw payload", () => {
  assert.equal(D.canWrite("member"), false);
  assert.equal(D.canReadRaw("member"), false);
  assert.equal(D.canWrite("admin"), true);
  assert.equal(D.canReadRaw("admin"), true);
  assert.equal(D.canWrite("viewer"), false);
  assert.equal(D.canReadRaw("viewer"), false);
});
test("model creation rejects duplicates and unsafe names", () => {
  assert.equal(D.validateName("orders_daily", D.seed().models), "duplicate");
  assert.equal(D.validateName("../escape", []), "format");
  assert.equal(D.validateName("demo_summary", []), null);
});
test("every run, model and record reference points to an existing fixture", () => {
  const db = D.seed();
  for (const m of db.models)
    if (m.lastRun)
      assert.ok(db.runs.some((r) => r.id === m.lastRun && r.target === m.name));
  for (const r of db.records) {
    assert.ok(db.sources.some((s) => s.id === r.source));
    for (const w of r.writes)
      assert.ok(db.runs.some((run) => run.id === w.run && run.target === r.source));
    assert.equal(r.run, r.writes[r.writes.length - 1].run);
  }
});
test("CSV quotes payload strings without parsing them", () => {
  assert.equal(D.csv([["a,b", '"quoted"']]), '"a,b","""quoted"""');
});
test("fixture clones isolate saved scope from drafts", () => {
  const scope = D.seed().sources[0].scope,
    draft = D.clone(scope);
  draft.entities = [];
  assert.equal(scope.entities.length, 3);
});
test("scope fixtures preserve discriminants and chosen id/name structures", () => {
  for (const source of D.seed().sources) {
    const scope = source.scope || D.emptyScope(source.kind);
    assert.equal(scope.kind, source.kind);
    if (source.kind === "gmail")
      for (const label of scope.labels) assert.ok(label.id && label.name);
    if (source.kind === "xero")
      assert.ok(scope.organisation.id && scope.organisation.name);
    if (source.kind === "drive")
      for (const file of scope.files)
        assert.ok(["file", "folder"].includes(file.kind));
  }
});
test("model tests use the supported typed shape and clone safely", () => {
  const model = D.seed().models[0],
    draft = D.clone(model.tests);
  assert.deepEqual(model.tests, { columns: { id: ["not_null"] } });
  draft.columns.id.push("unique");
  assert.equal(model.tests.columns.id.length, 1);
});
