/**
 * The four Kestra 1.x spellings that a 2.x server refuses, and the flows in `flows/`.
 *
 * WHY THIS GATE EXISTS. `kestraFlows.test.ts` next door proves the DELIVERY client works --
 * it retries, it falls back to the un-prefixed path, it fails fast on a rejection. It says
 * nothing about whether the flows it delivers are valid, and for a long time nothing did:
 * `ingest_due.yml` carried four separate 1.x spellings, CI was green on every one, and the
 * platform scheduled nothing at all. The failure never surfaced because the flows had never
 * reached a running Kestra to be rejected by.
 *
 * TWO OF THE FOUR ARE INVISIBLE TO KESTRA'S OWN VALIDATOR. `POST /flows/validate` type-checks
 * the task graph, so it catches `ForEach` (no such type) and a flat `connectTimeout` (no such
 * property). It does NOT evaluate expressions, so `json(...)` and `taskrun.value` validate
 * clean and then fail at render time on the first real iteration -- a flow that is green in
 * the UI and does nothing. Those two are the reason this is a test and not a deploy-time check.
 *
 * Each rule below was read off the RUNNING 2.0.2 server -- its plugin schema for
 * `io.kestra.plugin.core.http.Request`, and Kestra's own `$examples` for
 * `io.kestra.plugin.core.flow.Loop` -- not off the published docs, which still show the 1.x
 * shape. If Kestra changes again, the server is the authority and this file follows it.
 */

import { describe, expect, test as it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FLOWS_DIR = join(import.meta.dir, "..", "flows");

/** 2.x dropped the type outright; the server answers "Invalid type". */
const FOR_EACH = "io.kestra.plugin.core.flow.ForEach";
const REQUEST = "io.kestra.plugin.core.http.Request";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every task in a flow, including those nested inside a `Loop`, `errors` or `finally`. */
function tasksOf(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      tasksOf(child, found);
    }
    return found;
  }
  if (!isRecord(node)) {
    return found;
  }
  if (typeof node.type === "string") {
    found.push(node);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value) || isRecord(value)) {
      tasksOf(value, found);
    }
  }
  return found;
}

/**
 * The two spellings only a render would catch.
 *
 * Whole-line comments are dropped first, so a comment may NAME the banned spelling to explain
 * why it is banned -- which is exactly what the note above each fixed task in `flows/` does,
 * and it should not trip its own rule.
 */
function expressionProblems(yaml: string): string[] {
  const code = yaml
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const problems: string[] = [];

  if (code.includes("{{ json(") || code.includes("{{json(")) {
    problems.push("uses the `json()` Pebble function, removed in 2.x -- use `fromJson()`");
  }
  if (code.includes("taskrun.value")) {
    problems.push(
      "uses `taskrun.value`, which is not in scope in a Loop sub-execution -- use `item.value`",
    );
  }
  return problems;
}

/** The three a 2.x server rejects outright, read off the parsed task graph. */
function taskProblems(task: Record<string, unknown>): string[] {
  const id = String(task.id);
  if (task.type === FOR_EACH) {
    return [`${id}: uses ForEach, dropped in 2.x -- use Loop`];
  }
  if (task.type !== REQUEST) {
    return [];
  }

  const problems: string[] = [];
  if ("allowFailed" in task) {
    problems.push(`${id}: \`allowFailed\` is an HTTP option in 2.x, not a task property`);
  }
  const { options } = task;
  if (isRecord(options)) {
    for (const flat of ["connectTimeout", "readIdleTimeout"]) {
      if (flat in options) {
        problems.push(`${id}: \`${flat}\` must sit under \`options.timeout\` in 2.x`);
      }
    }
  }
  return problems;
}

/** What a 2.0.2 server would refuse, named the way an author can act on. */
function flowViolations(yaml: string): string[] {
  const doc: unknown = Bun.YAML.parse(yaml);
  return [...expressionProblems(yaml), ...tasksOf(doc).flatMap(taskProblems)];
}

function flowFiles(): { name: string; yaml: string }[] {
  return readdirSync(FLOWS_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => ({ name, yaml: readFileSync(join(FLOWS_DIR, name), "utf8") }));
}

describe("the flows this repository ships", () => {
  it("are all written in the 2.x spellings the deployed server accepts", () => {
    // The one that matters. Everything below proves the check can tell the difference; this
    // proves `flows/` currently passes it.
    const offenders = flowFiles().flatMap(({ name, yaml }) =>
      flowViolations(yaml).map((problem) => `${name}: ${problem}`),
    );

    expect(offenders).toEqual([]);
  });

  it("is a directory with flows in it, so the check above cannot pass by finding nothing", () => {
    expect(flowFiles().length).toBeGreaterThan(0);
  });
});

describe("a flow written the 1.x way", () => {
  const ONE_X = `id: legacy
namespace: undercroft
tasks:
  - id: due
    type: io.kestra.plugin.core.http.Request
    uri: http://worker:8081/v1/runs/due
    options:
      connectTimeout: PT30S
      readIdleTimeout: PT1M
  - id: start
    type: io.kestra.plugin.core.flow.ForEach
    values: "{{ json(outputs.due.body).due }}"
    tasks:
      - id: go
        type: io.kestra.plugin.core.http.Request
        uri: http://worker:8081/v1/runs/ingest
        body: "{{ taskrun.value }}"
        allowFailed: true
`;

  it("is caught on every one of the five things a 2.x server refuses", () => {
    const problems = flowViolations(ONE_X).join("\n");

    expect(problems).toContain("json()");
    expect(problems).toContain("taskrun.value");
    expect(problems).toContain("ForEach");
    expect(problems).toContain("connectTimeout");
    expect(problems).toContain("allowFailed");
  });

  it("is caught inside a nested loop too, not only at the top level", () => {
    // The 1.x `taskrun.value` lived on a task two levels down; a check that only walked the
    // top-level task list would have called `ingest_due.yml` clean.
    const nested = ONE_X.replace(
      "type: io.kestra.plugin.core.flow.ForEach",
      "type: io.kestra.plugin.core.flow.Loop",
    );

    expect(flowViolations(nested).join("\n")).toContain("allowFailed");
  });
});
