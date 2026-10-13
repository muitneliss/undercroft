/**
 * A run's steps as an answer: the summary counts every step as dbt wrote it, the default lists
 * what needs reading, and a page walks the selection without skipping or repeating a step.
 */

import { describe, expect, test as it } from "bun:test";
import type { RunStep } from "@undercroft/db/repos";

import { reportSteps } from "./stepReport.ts";

function step(kind: RunStep["kind"], name: string, status: string): RunStep {
  return {
    uniqueId: `${kind}.shop.${name}`,
    kind,
    name,
    status,
    failures: kind === "test" ? 0 : null,
    relation: null,
    message: null,
    executionMs: 12,
  };
}

/** A build the shape of a real one: mostly passing, one failure, its shadow skipped, a warning. */
const RUN: RunStep[] = [
  step("test", "unique_orders_id", "pass"),
  step("model", "orders", "success"),
  step("test", "not_null_orders_total", "fail"),
  step("model", "revenue", "skipped"),
  step("test", "accepted_values_status", "warn"),
  step("model", "customers", "success"),
  step("test", "not_null_revenue_day", "skipped"),
  step("model", "ledger", "error"),
];

function names(steps: readonly RunStep[]): string[] {
  return steps.map((s) => s.name);
}

describe("the summary", () => {
  it("counts every step by kind and dbt status, a skip as a skip and never as a pass", () => {
    const { stepSummary } = reportSteps(RUN, { steps: "none", stepLimit: 100 });

    expect(stepSummary).toEqual({
      total: 8,
      byStatus: {
        model: { success: 2, skipped: 1, error: 1 },
        test: { pass: 1, fail: 1, warn: 1, skipped: 1 },
        seed: {},
      },
      problems: 3,
    });
  });

  it("is there for a run with no steps at all, saying so in zeroes it actually counted", () => {
    expect(reportSteps([], { stepLimit: 100 })).toEqual({
      stepSummary: { total: 0, byStatus: { model: {}, test: {}, seed: {} }, problems: 0 },
      steps: [],
      nextStepCursor: null,
    });
  });
});

describe("which steps are listed", () => {
  it("by default, the problems: a failure, an error and a warning, but no pass and no skip", () => {
    expect(names(reportSteps(RUN, { stepLimit: 100 }).steps)).toEqual([
      "ledger",
      "accepted_values_status",
      "not_null_orders_total",
    ]);
  });

  it("a status nobody here has seen is listed as a problem rather than assumed fine", () => {
    const odd = [...RUN, step("model", "snapshot_like", "no-op")];
    expect(names(reportSteps(odd, { stepLimit: 100 }).steps)).toContain("snapshot_like");
  });

  it("every step, ordered by kind then name, when asked for all", () => {
    expect(names(reportSteps(RUN, { steps: "all", stepLimit: 100 }).steps)).toEqual([
      "customers",
      "ledger",
      "orders",
      "revenue",
      "accepted_values_status",
      "not_null_orders_total",
      "not_null_revenue_day",
      "unique_orders_id",
    ]);
  });

  it("a filter given without `steps` reads every step through it, so asking for skips finds them", () => {
    expect(names(reportSteps(RUN, { stepStatus: "skipped", stepLimit: 100 }).steps)).toEqual([
      "revenue",
      "not_null_revenue_day",
    ]);
  });

  it("a filter given with `steps` narrows that set, and finding nothing is an empty page", () => {
    const tests = reportSteps(RUN, { steps: "problems", stepKind: "test", stepLimit: 100 });
    expect(names(tests.steps)).toEqual(["accepted_values_status", "not_null_orders_total"]);

    const none = reportSteps(RUN, { steps: "problems", stepStatus: "pass", stepLimit: 100 });
    expect(none.steps).toEqual([]);
    expect(none.stepSummary.total).toBe(8);
  });

  it("a name filter matches part of a name, whatever its case", () => {
    expect(names(reportSteps(RUN, { stepName: "REVENUE", stepLimit: 100 }).steps)).toEqual([
      "revenue",
      "not_null_revenue_day",
    ]);
  });
});

describe("a page of steps", () => {
  it("walks the selection with its cursor, neither skipping nor repeating a step", () => {
    const walked: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const answer = reportSteps(RUN, { steps: "all", stepLimit: 3, stepCursor: cursor });
      walked.push(...names(answer.steps));
      if (answer.nextStepCursor === null) {
        break;
      }
      cursor = answer.nextStepCursor;
    }

    expect(walked).toEqual(names(reportSteps(RUN, { steps: "all", stepLimit: 100 }).steps));
  });

  it("the last page says there is no next one, and a full selection on one page says the same", () => {
    expect(reportSteps(RUN, { steps: "all", stepLimit: 8 }).nextStepCursor).toBeNull();
    expect(reportSteps(RUN, { steps: "all", stepLimit: 7 }).nextStepCursor).not.toBeNull();
  });

  it("a cursor that is not one of ours reads from the top, as a stale bookmark does", () => {
    const fromTop = reportSteps(RUN, { steps: "all", stepLimit: 2 });
    const garbled = reportSteps(RUN, { steps: "all", stepLimit: 2, stepCursor: "not-a-cursor" });
    expect(names(garbled.steps)).toEqual(names(fromTop.steps));
  });
});
