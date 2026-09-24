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
