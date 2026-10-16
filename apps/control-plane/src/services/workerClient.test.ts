/**
 * What survives the hop to the worker: not the body, only the status.
 *
 * The control plane deliberately never reads a refusal's body -- a request to these
 * endpoints can carry a live refresh token, and echoing one into a log or an error message
 * is how a credential ends up somewhere it was never meant to be. That leaves the status
 * line as the entire vocabulary for "why not", so which status means what is a contract
 * rather than a detail, and it is pinned here.
 */

import { describe, expect, test as it } from "bun:test";

import { createHttpWorkerClient, type WorkerClient } from "./workerClient.ts";

/** Answers every request with one status. A real function, not a spy. */
function answering(status: number): WorkerClient {
  return createHttpWorkerClient({
    baseUrl: "https://worker.test",
    triggerToken: "t",
    fetch: () => Promise.resolve(new Response("{}", { status })),
  });
}

describe("reading a worker refusal", () => {
  it("403 is the grant, not the worker", async () => {
    // The one failure an administrator can fix from the screen they are looking at, so it
    // must arrive distinguishable. Worded as an outage -- which it was until this mapping
    // existed -- it sends them off to wait for a service that is answering fine.
    const outcome = await answering(403).browseScope({
      source: "gmail",
      tenantId: "CASE-0042",
      kind: "labels",
    });

    expect(outcome).toEqual({ ok: false, reason: "scope-insufficient" });
  });

  it("409 from the browse is the credential, and 409 elsewhere is still a run in progress", async () => {
    // A browse starts no run, so its 409 is the stored credential that could not be refreshed
    // (issue 213) -- read from the status, like every refusal here. The other side: the map is
    // the browse's own, and a status-only call's 409 still means the tenant is busy.
    const browsed = await answering(409).browseScope({
      source: "gmail.3fa9c1d2e0ab",
      tenantId: "CASE-0042",
      kind: "labels",
    });
    const read = await answering(409).readSchema({ tenantId: "CASE-0042", scope: null });

    expect(browsed).toEqual({ ok: false, reason: "credential-expired" });
    expect(read).toEqual({ ok: false, reason: "in-progress" });
  });

  it("504 from the search is its time limit, and the search's 500 stays a plain refusal", async () => {
    // #447: a search Postgres cancelled at its timeout reached the screen as "the service did
    // not answer; try again", and callers did, with the same question. The status names it.
    const timedOut = await answering(504).searchRaw({
      tenantId: "CASE-0042",
      q: "invoice",
      streams: null,
    });
    const crashed = await answering(500).searchRaw({
      tenantId: "CASE-0042",
      q: "invoice",
      streams: null,
    });

    expect(timedOut).toEqual({ ok: false, reason: "timed-out" });
    expect(crashed).toEqual({ ok: false, reason: "refused" });
  });

  it("504 is read as a time limit by the search alone", async () => {
    // The quiet side: only the search's worker verb raises it, and a 504 from anywhere else is
    // not a statement this control plane knows to have been cancelled.
    const outcome = await answering(504).readRawSchema({ tenantId: "CASE-0042" });

    expect(outcome).toEqual({ ok: false, reason: "refused" });
  });

  it("any other refusal stays a plain refusal", async () => {
    // The quiet side. A guard that answered `scope-insufficient` to everything would tell
    // an operator to reconnect a credential that was never the problem.
    const outcome = await answering(500).browseScope({
      source: "gmail",
      tenantId: "CASE-0042",
      kind: "labels",
    });

    expect(outcome).toEqual({ ok: false, reason: "refused" });
  });

  it("a worker that cannot be reached at all is unreachable, not refused", async () => {
    const client = createHttpWorkerClient({
      baseUrl: "https://worker.test",
      triggerToken: "t",
      fetch: () => Promise.reject(new Error("connection refused")),
    });

    const outcome = await client.browseScope({
      source: "gmail",
      tenantId: "CASE-0042",
      kind: "labels",
    });

    expect(outcome).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("reading a refused model drop", () => {
  /** Answers every request with a 409 carrying this envelope, as the worker's drop does. */
  function refusingWith(envelope: unknown): WorkerClient {
    return createHttpWorkerClient({
      baseUrl: "https://worker.test",
      triggerToken: "t",
      fetch: () => Promise.resolve(Response.json(envelope, { status: 409 })),
    });
  }
  const input = { tenantId: "CASE-0042", model: "stg_deals" };

  it("names what reads from the model, and tells that from a build in progress", async () => {
    // The one refusal body read on this call. Both are 409s and want different sentences: the
    // person must learn WHICH models to deal with, or that they only have to wait.
    const depended = await refusingWith({
      code: "relation_depended_on",
      message: "other relations read from this model",
      details: ["fct_pipeline"],
    }).dropModel(input);
    const building = await refusingWith({
      code: "run_in_progress",
      message: "transform is already running",
      details: ["run-1"],
    }).dropModel(input);

    expect(depended).toEqual({ ok: false, reason: "depended-on", dependents: ["fct_pipeline"] });
    expect(building).toEqual({ ok: false, reason: "in-progress" });
  });
});

describe("reading a refused model preview (ADR 0132)", () => {
  function answeringWith(envelope: unknown, status: number): WorkerClient {
    return createHttpWorkerClient({
      baseUrl: "https://worker.test",
      triggerToken: "t",
      fetch: () => Promise.resolve(Response.json(envelope, { status })),
    });
  }
  const input = { tenantId: "CASE-0042", name: "stg_deals", sql: "select 1", limit: 10 };

  it("a 400 says which text was refused, dbt's model or Postgres's SQL, and quotes why", async () => {
    // Both are 400s, and the author fixes them in different places: the model, or the query.
    const compile = await answeringWith(
      { code: "compile_failed", message: "Compilation Error in model stg_deals", details: [] },
      400,
    ).previewModel(input);
    const query = await answeringWith(
      { code: "query_failed", message: 'column "nope" does not exist', details: [] },
      400,
    ).previewModel(input);
    const other = await answeringWith(
      { code: "invalid_request", message: "tenantId, name and sql are required", details: [] },
      400,
    ).previewModel(input);

    expect([compile, query, other]).toEqual([
      { ok: false, reason: "compile-failed", message: "Compilation Error in model stg_deals" },
      { ok: false, reason: "query-failed", message: 'column "nope" does not exist' },
      { ok: false, reason: "refused" },
    ]);
  });
});

describe("reading a browse answer from a worker of another build", () => {
  it("a worker built before `partial` and `kind` is read as what it was: whole, unclassified", async () => {
    // Worker and control plane deploy separately, so for a while one answers the other in an
    // older shape. Cast rather than parsed, the missing `partial` would reach an agent as no
    // answer at all to "is this list complete" -- which is not the same as "yes".
    const client = createHttpWorkerClient({
      baseUrl: "https://worker.test",
      triggerToken: "t",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [{ id: "Label_8", name: "Invoices" }] }), {
            status: 200,
          }),
        ),
    });

    const outcome = await client.browseScope({
      source: "gmail",
      tenantId: "CASE-0042",
      kind: "labels",
    });

    expect(outcome).toEqual({
      ok: true,
      value: { items: [{ id: "Label_8", name: "Invoices", kind: null }], partial: [] },
    });
  });
});

describe("a build over the wire", () => {
  const build = { tenantId: "CASE-0042", select: ["stg_deals"], wait: true, triggeredBy: "u-1" };

  /** A worker that answers every request with `body` and `status`, and keeps what it was sent. */
  function worker(status: number, body: unknown): { client: WorkerClient; sent: unknown[] } {
    const sent: unknown[] = [];
    const client = createHttpWorkerClient({
      baseUrl: "https://worker.test",
      triggerToken: "t",
      fetch: (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Promise.resolve(Response.json(body, { status }));
      },
    });
    return { client, sent };
  }

  it("a build already running names its run, which only the 409's body says", async () => {
    // Issue 442: the refusal used to be the status alone, and an agent retried blind -- seven
    // times in the audit, usually against its own build that had timed out on its side.
    const { client } = worker(409, {
      code: "run_in_progress",
      message: "transform is already running",
      details: ["run-held"],
    });

    expect(await client.buildModels(build)).toEqual({
      ok: false,
      reason: "in-progress",
      runId: "run-held",
    });
  });

  it("a 409 that is not a run in progress is a refusal, not a build to wait for", async () => {
    const { client } = worker(409, { code: "tenant_deactivated", message: "", details: [] });

    expect(await client.buildModels(build)).toEqual({ ok: false, reason: "refused" });
  });

  it("202 is a build not waited for, answered with its run", async () => {
    const { client } = worker(202, { runId: "run-started" });

    expect(await client.buildModels({ ...build, wait: false })).toEqual({
      ok: true,
      value: { waited: false, runId: "run-started" },
    });
  });

  it("one plain model is also sent as `model`, for a worker older than `select`", async () => {
    // The worker and the control plane deploy separately. An older worker reads only `model`;
    // given it, it builds the same one model rather than refusing.
    const answer = {
      runId: "run-1",
      ok: true,
      testsFailed: 0,
      error: null,
      steps: [],
      preview: null,
    };
    const { client, sent } = worker(200, answer);

    const built = await client.buildModels(build);

    expect(sent).toEqual([{ ...build, model: "stg_deals" }]);
    // That older worker counts nothing: no counts, which is not a count of zero.
    expect(built).toEqual({ ok: true, value: { waited: true, ...answer, rowCounts: [] } });
  });

  it("several models, or one with a `+`, are never narrowed to `model` for an older worker", async () => {
    const { client, sent } = worker(400, { code: "invalid_request", message: "", details: [] });

    await client.buildModels({ ...build, select: ["stg_deals", "fct_pipeline"] });
    await client.buildModels({ ...build, select: ["+stg_deals"] });

    expect(sent).toEqual([
      { ...build, select: ["stg_deals", "fct_pipeline"] },
      { ...build, select: ["+stg_deals"] },
    ]);
  });
});

/**
 * A worker that has only the routes it is given, as one older than a route answers: 404 for any
 * other. It keeps the path and the body of everything it was sent.
 */
function routed(paths: readonly string[], sent: { path: string; body: unknown }[]): WorkerClient {
  return createHttpWorkerClient({
    baseUrl: "https://worker.test",
    triggerToken: "t",
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      sent.push({ path, body: JSON.parse(String(init?.body ?? "null")) });
      return paths.includes(path)
        ? new Response(
            '{"columns":[],"rows":[],"truncated":false,"tables":[],"hits":[],"capped":[]}',
            {
              status: 200,
            },
          )
        : new Response("{}", { status: 404 });
    },
  });
}

describe("a scoped read goes where only a worker that knows scopes answers (ADR 0142)", () => {
  it("a scope is sent to the scoped route and nowhere else; none goes to the route of old", async () => {
    const sent: { path: string; body: unknown }[] = [];
    const worker = routed(["/v1/queries/run", "/v1/queries/scoped/run"], sent);
    const scope = { models: ["fct_sales"] };

    await worker.runQuery({ tenantId: "CASE-0042", sql: "select 1", limit: 1, scope });
    await worker.runQuery({ tenantId: "CASE-0042", sql: "select 1", limit: 1, scope: null });

    expect(sent).toEqual([
      {
        path: "/v1/queries/scoped/run",
        body: { tenantId: "CASE-0042", sql: "select 1", limit: 1, scope },
      },
      { path: "/v1/queries/run", body: { tenantId: "CASE-0042", sql: "select 1", limit: 1 } },
    ]);
  });

  it("a worker that predates scopes refuses a scoped read, a schema and a narrowed search", async () => {
    const old = routed(["/v1/queries/run", "/v1/queries/schema", "/v1/queries/raw/search"], []);
    const scope = { models: ["fct_sales"] };

    const query = await old.runQuery({ tenantId: "CASE-0042", sql: "select 1", limit: 1, scope });
    const schema = await old.readSchema({ tenantId: "CASE-0042", scope });
    const search = await old.searchRaw({
      tenantId: "CASE-0042",
      q: "x",
      streams: [{ source: "hubspot", entity: null }],
    });

    expect([query.ok, schema.ok, search.ok]).toEqual([false, false, false]);
  });
});
