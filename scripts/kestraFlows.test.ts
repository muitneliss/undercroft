/**
 * Flow delivery decides whether a deploy scheduled anything, so the two ways it can lie are
 * what this pins: giving up on a Kestra that is merely still starting, and waiting on a flow
 * Kestra has already refused.
 *
 * The fetcher REFUSES a request nobody recorded rather than answering a default, for the
 * reason `scripts/dokploy.test.ts` gives.
 */

// biome-ignore-all lint/nursery/useValidTestTitle: The titles this flags are full sentences describing the promise under test -- "is clamped, so a hostile header cannot park a run for hours" -- which is exactly what the repo asks a test title to be. The rule wants a shorter shape.

import { describe, expect, test as it } from "bun:test";

import {
  type Config,
  type Deps,
  deliverFlows,
  FlowRejected,
  type FlowFile,
  identify,
  KestraUnavailable,
} from "./kestraFlows.ts";

const CFG: Config = {
  baseUrl: "http://kestra.test:8080",
  user: "admin@example.test",
  password: "pw",
  deadlineMs: 60_000,
  retryMs: 1000,
};

const FLOW: FlowFile = {
  file: "ingest_due.yml",
  yaml: ["id: ingest_due", "namespace: undercroft", "tasks:", "  - id: noop"].join("\n"),
};

const PUT = "PUT http://kestra.test:8080/api/v1/main/flows/undercroft/ingest_due";
const POST = "POST http://kestra.test:8080/api/v1/main/flows";
const LEGACY_PUT = "PUT http://kestra.test:8080/api/v1/flows/undercroft/ingest_due";
const LEGACY_POST = "POST http://kestra.test:8080/api/v1/flows";

type Answer = { status: number; body?: string } | "refused";

interface Recorder {
  readonly deps: Deps;
  readonly asked: string[];
  readonly sent: RequestInit[];
  readonly lines: string[];
}

/** Each key answers its recorded responses in order; an unrecorded request is refused. */
function recorder(answers: Record<string, Answer[]>, clock = { ms: 0 }): Recorder {
  const asked: string[] = [];
  const sent: RequestInit[] = [];
  const lines: string[] = [];
  const queues = new Map(Object.entries(answers).map(([k, v]) => [k, [...v]]));
  const deps: Deps = {
    fetch: (input: string, init?: RequestInit): Promise<Response> => {
      const key = `${init?.method ?? "GET"} ${input}`;
      asked.push(key);
      if (init !== undefined) {
        sent.push(init);
      }
      const next = queues.get(key)?.shift();
      if (next === undefined) {
        return Promise.reject(new Error(`no recorded response for ${key}`));
      }
      if (next === "refused") {
        return Promise.reject(new Error("connect ECONNREFUSED"));
      }
      return Promise.resolve(new Response(next.body ?? "", { status: next.status }));
    },
    sleep: (ms: number): Promise<void> => {
      clock.ms += ms;
      return Promise.resolve();
    },
    log: (line: string): void => {
      lines.push(line);
    },
    now: (): number => clock.ms,
  };
  return { deps, asked, sent, lines };
}

describe("identify", () => {
  it("reads the flow's id and namespace off its top-level lines", () => {
    expect(identify(FLOW)).toEqual({ id: "ingest_due", namespace: "undercroft" });
  });

  it("a flow with no id is refused before Kestra sees it", () => {
    expect(() => identify({ file: "x.yml", yaml: "namespace: undercroft\n" })).toThrow(
      "x.yml: a flow needs",
    );
  });
});

describe("deliverFlows", () => {
  it("updates a flow Kestra already has, as yaml, with basic auth", async () => {
    const r = recorder({ [PUT]: [{ status: 200 }] });
    const delivery = await deliverFlows(CFG, r.deps, [FLOW]);

    expect(delivery).toEqual({ created: [], updated: ["ingest_due.yml"] });
    expect(r.asked).toEqual([PUT]);
    const headers = new Headers(r.sent[0]?.headers);
    expect(headers.get("content-type")).toBe("application/x-yaml");
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from("admin@example.test:pw").toString("base64")}`,
    );
    expect(r.sent[0]?.body).toBe(FLOW.yaml);
  });

  it("creates a flow Kestra does not have yet", async () => {
    const r = recorder({ [PUT]: [{ status: 404 }], [POST]: [{ status: 200 }] });
    const delivery = await deliverFlows(CFG, r.deps, [FLOW]);

    expect(delivery).toEqual({ created: ["ingest_due.yml"], updated: [] });
    expect(r.asked).toEqual([PUT, POST]);
  });

  it("falls back to the un-prefixed path when the tenant path does not exist", async () => {
    // A 404 on CREATE cannot mean "no such flow": it is an older Kestra with no tenant in
    // the path, and the same two requests are made once more without it.
    const r = recorder({
      [PUT]: [{ status: 404 }],
      [POST]: [{ status: 404 }],
      [LEGACY_PUT]: [{ status: 404 }],
      [LEGACY_POST]: [{ status: 200 }],
    });
    const delivery = await deliverFlows(CFG, r.deps, [FLOW]);

    expect(delivery.created).toEqual(["ingest_due.yml"]);
    expect(r.asked).toEqual([PUT, POST, LEGACY_PUT, LEGACY_POST]);
  });

  it("waits for a Kestra that is still starting, then delivers", async () => {
    const r = recorder({ [PUT]: ["refused", { status: 503 }, { status: 200 }] });
    const delivery = await deliverFlows(CFG, r.deps, [FLOW]);

    expect(delivery.updated).toEqual(["ingest_due.yml"]);
    expect(r.asked).toEqual([PUT, PUT, PUT]);
    expect(r.lines.filter((l) => l.includes("waiting for Kestra"))).toHaveLength(2);
  });

  it("a flow Kestra rejected fails at once and is not retried", async () => {
    const r = recorder({ [PUT]: [{ status: 422, body: "Invalid entity: tasks[0].type" }] });
    let refusal: unknown;
    try {
      await deliverFlows(CFG, r.deps, [FLOW]);
    } catch (error) {
      refusal = error;
    }
    if (!(refusal instanceof FlowRejected)) {
      throw new Error("expected the flow to be refused");
    }
    expect(refusal.message).toContain("tasks[0].type");
    expect(r.asked).toEqual([PUT]);
  });

  it("gives up once the deadline has passed, naming the outage", async () => {
    const clock = { ms: 0 };
    const r = recorder({ [PUT]: new Array<Answer>(100).fill("refused") }, clock);
    let outage: unknown;
    try {
      await deliverFlows({ ...CFG, deadlineMs: 3000, retryMs: 1000 }, r.deps, [FLOW]);
    } catch (error) {
      outage = error;
    }
    expect(outage).toBeInstanceOf(KestraUnavailable);
    // Asked at 0, 1000, 2000 and 3000ms; the fourth refusal is past the deadline.
    expect(r.asked).toHaveLength(4);
  });
});
