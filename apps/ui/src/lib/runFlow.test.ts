/**
 * What `deriveRunFlow` promises: a stage exists once there is evidence for it and never
 * before, at most one stage is ever struck for a failure, and the closed ledger never says
 * less than the live feed already did.
 */

import { describe, expect, test as it } from "bun:test";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { translatorFor } from "@/i18n/index.ts";
import { deriveRunFlow, type RunStage } from "@/lib/runFlow.ts";
import { runDetail, runLink } from "@/test/fixtures.ts";

const en = translatorFor("en");

function href(id: string): string {
  return `/journal/${id}`;
}

function flow(run: RunDetail, events: readonly RunEventView[] = []): readonly RunStage[] {
  return deriveRunFlow(en, "en", { run, events, runHref: href });
}

function event(
  name: string,
  detail: Record<string, unknown>,
  entity: string | null = null,
): RunEventView {
  return {
    at: "2026-09-19T12:42:22.000Z",
    level: "info",
    event: name,
    entity,
    detail,
    live: false,
  };
}

describe("an ingest run in progress", () => {
  it("shows only the entities mentioned so far, in the order they were started", () => {
    const detail = runDetail({ status: "running", counts: null, endedAt: null });
    const events = [
      event("run_opened", {}),
      event("entity_started", {}, "contacts"),
      event("entity_done", { landed: 40, refused: 0 }, "contacts"),
      event("entity_started", {}, "deals"),
      event("records_read", { read: 12, total: 50 }, "deals"),
    ];

    const stages = flow(detail, events);

    expect(stages.map((s) => s.key)).toEqual(["entity:contacts", "entity:deals", "outcome"]);
    expect(stages[0]).toMatchObject({ label: "contacts", mark: "granted", detail: "40 records" });
    expect(stages[1]).toMatchObject({ label: "deals", mark: "pending", detail: "12 / 50" });
    // The run itself is still going, distinct from any one entity's own state.
    expect(stages[2]).toMatchObject({ mark: "pending" });
  });

  it("names no entity at all until the feed has said something about one", () => {
    const detail = runDetail({ status: "running", counts: null, endedAt: null });
    const stages = flow(detail, [event("run_opened", {})]);

    expect(stages.map((s) => s.key)).toEqual(["outcome"]);
  });
});

describe("a failed ingest run", () => {
  it("strikes the one entity that was mid-flight, and nothing after it", () => {
    const detail = runDetail({
      status: "failed",
      error: "answered 500",
      counts: { landed: 40, created: 40, changed: 0, unchanged: 0, refused: 0 },
      entityCounts: [
        { entity: "contacts", landed: 40, created: 40, changed: 0, unchanged: 0, refused: 0 },
      ],
    });
    const events = [
      event("entity_started", {}, "contacts"),
      event("entity_done", { landed: 40, refused: 0 }, "contacts"),
      event("entity_started", {}, "deals"),
      event("run_failed", { errorType: "HttpError" }),
    ];

    const stages = flow(detail, events);

    expect(stages.map((s) => [s.key, s.mark])).toEqual([
      ["entity:contacts", "granted"],
      ["entity:deals", "lapsed"],
      ["outcome", "lapsed"],
    ]);
    expect(stages[1]?.markLabel).toBe("Stopped here");
  });

  it("a run that never started an entity strikes nothing but its own outcome", () => {
    const detail = runDetail({ status: "failed", error: "no usable grant", counts: null });
    const stages = flow(detail);

    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ key: "outcome", mark: "lapsed" });
  });
});

describe("a closed run's authoritative record", () => {
  it("keeps the feed's order and appends what only entityCounts remembers", () => {
    // The feed narrated "deals" (an events cap, or a run that predates the journal, can
    // leave a real entity out of it); entityCounts still names "contacts" too, and it is
    // never allowed to say less than the live feed already did.
    const detail = runDetail({
      status: "ok",
      counts: { landed: 90, created: 90, changed: 0, unchanged: 0, refused: 10 },
      entityCounts: [
        { entity: "contacts", landed: 50, created: 50, changed: 0, unchanged: 0, refused: 0 },
        { entity: "deals", landed: 40, created: 40, changed: 0, unchanged: 0, refused: 10 },
      ],
    });
    const events = [
      event("entity_started", {}, "deals"),
      event("entity_done", { landed: 40, refused: 10 }, "deals"),
    ];

    const stages = flow(detail, events);

    expect(stages.map((s) => s.key)).toEqual(["entity:deals", "entity:contacts", "outcome"]);
    expect(stages[0]).toMatchObject({ mark: "granted", detail: "40 records · 10 refused" });
    expect(stages[1]).toMatchObject({ mark: "granted", detail: "50 records" });
  });

  it("with no feed at all, still shows every entity entityCounts remembers", () => {
    const detail = runDetail({
      status: "ok",
      entityCounts: [
        { entity: "deals", landed: 5, created: 5, changed: 0, unchanged: 0, refused: 0 },
      ],
    });

    const stages = flow(detail);
    expect(stages.map((s) => s.key)).toEqual(["entity:deals", "outcome"]);
  });
});

describe("a transform run", () => {
  it("while running, carries no evidence it does not have", () => {
    const detail = runDetail({
      kind: "transform",
      source: null,
      entities: [],
      status: "running",
      counts: null,
    });
    const stages = flow(detail, [event("run_opened", {})]);

    expect(stages).toEqual([
      expect.objectContaining({ key: "models", mark: "pending", detail: null }),
    ]);
  });

  it("says plainly when there was nothing to build", () => {
    const detail = runDetail({
      kind: "transform",
      source: null,
      entities: [],
      status: "ok",
      counts: { landed: 0, created: 0, changed: 0, unchanged: 0, refused: 0 },
      steps: [],
    });
    const stages = flow(detail, [event("no_models", {})]);

    expect(stages[0]).toMatchObject({ mark: "granted", detail: "No models" });
  });

  it("summarises what it built, and calls out a failing test separately from a passing one", () => {
    const steps = [
      {
        uniqueId: "m1",
        kind: "model" as const,
        name: "stg_deals",
        status: "success",
        failures: null,
        relation: null,
        message: null,
        executionMs: 10,
      },
      {
        uniqueId: "t1",
        kind: "test" as const,
        name: "not_null_id",
        status: "fail",
        failures: 2,
        relation: null,
        message: null,
        executionMs: 5,
      },
    ];
    const ok = runDetail({
      kind: "transform",
      source: null,
      entities: [],
      status: "ok",
      steps,
      testsFailed: 0,
    });
    expect(flow(ok)[0]?.detail).toBe("1 models · 1 tests");

    const withFailure = runDetail({
      kind: "transform",
      source: null,
      entities: [],
      status: "ok",
      steps,
      testsFailed: 1,
    });
    expect(flow(withFailure)[0]?.detail).toBe("1 models · 1 tests · 1 failed");
  });
});

describe("a lake-api run", () => {
  it("has exactly one stage, with no entity breakdown", () => {
    const detail = runDetail({
      kind: "lake-api",
      source: "csv",
      entities: [],
      status: "ok",
      counts: { landed: 8, created: 8, changed: 0, unchanged: 0, refused: 0 },
    });

    const stages = flow(detail);
    expect(stages).toEqual([
      expect.objectContaining({ kind: "lake", mark: "granted", detail: "8 records" }),
    ]);
  });
});

describe("a run's place in its chain", () => {
  it("leads with the ingest it was chained from, carrying that run's own outcome", () => {
    const detail = runDetail({
      kind: "transform",
      source: null,
      entities: [],
      status: "ok",
      steps: [],
      parentRun: runLink({ id: "run-parent", kind: "ingest", source: "hubspot", status: "failed" }),
    });

    const stages = flow(detail);
    expect(stages[0]).toMatchObject({
      kind: "link-parent",
      mark: "lapsed",
      href: "/journal/run-parent",
      label: "Chained from the HubSpot ingest",
    });
  });

  it("trails with the build it was chained into, carrying that run's own outcome", () => {
    const detail = runDetail({
      status: "ok",
      childRun: runLink({ id: "run-child", kind: "transform", source: null, status: "running" }),
    });

    const stages = flow(detail);
    const last = stages.at(-1);
    expect(last).toMatchObject({ kind: "link-child", mark: "pending", href: "/journal/run-child" });
  });

  it("has no link stage at all for a run nothing has chained with", () => {
    const stages = flow(runDetail());
    expect(stages.some((s) => s.kind === "link-parent" || s.kind === "link-child")).toBe(false);
  });
});
