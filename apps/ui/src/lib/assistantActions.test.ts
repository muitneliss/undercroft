/**
 * What the assistant does in the browser, and what it refuses to do there.
 *
 * The promise worth testing is the one that makes this tier safe: `draftLakeQuery` WRITES a
 * query and does not run it. A version that ran it would look identical to the reader for the
 * first second and would have executed SQL nobody read against a customer's data.
 */

import { describe, expect, test as it } from "bun:test";

import { CLIENT_ACTIONS, draftLakeQuery, openDivision } from "@/lib/assistantActions.ts";
import type { DivisionId } from "@/lib/divisions.ts";

/** Records what was asked of the browser, so a test asserts on it rather than on a render. */
function spy(): {
  deps: Parameters<typeof openDivision>[0];
  went: string[];
  drafts: [string, string][];
} {
  const went: string[] = [];
  const drafts: [string, string][] = [];
  return {
    went,
    drafts,
    deps: {
      navigate: (path) => went.push(path),
      setLakeSql: (tenantId, sql) => drafts.push([tenantId, sql]),
      knownDivision: (id): id is DivisionId =>
        ["sources", "journal", "lake", "models", "reports"].includes(id),
    },
  };
}

describe("taking the reader to a division", () => {
  it("goes to that customer's page", () => {
    const { deps, went } = spy();
    const outcome = openDivision(deps, { tenantId: "CASE-0042", division: "journal" });
    expect(went).toEqual(["/tenants/CASE-0042/journal"]);
    expect(outcome.done).toBe(true);
  });

  it("refuses a division that does not exist rather than guessing one", () => {
    // Sending a reader to a guessed page is worse than telling the model it named something
    // that is not there. Rule 2.
    const { deps, went } = spy();
    const outcome = openDivision(deps, { tenantId: "CASE-0042", division: "invoices" });
    expect(went).toEqual([]);
    expect(outcome.done).toBe(false);
    expect(outcome.why).toContain("invoices");
  });
});

describe("drafting a query", () => {
  it("writes it into the console's editor and takes the reader there", () => {
    // Written down and nothing more: `deps` carries no runner, so there is nothing here that
    // could execute it. `lake.query` is reached by the reader pressing Run in the console.
    const { deps, went, drafts } = spy();
    const outcome = draftLakeQuery(deps, {
      tenantId: "CASE-0042",
      sql: "select 1 from analytics_x.invoices",
    });

    expect(drafts).toEqual([["CASE-0042", "select 1 from analytics_x.invoices"]]);
    expect(went).toEqual(["/tenants/CASE-0042/lake/console"]);
    // Says plainly that it did not run, because the model has to tell the reader that -- and a
    // bare "done" would invite it to claim the answer is already on screen.
    expect(outcome.why).toContain("not run");
  });

  it("writes the draft BEFORE moving, or the reader watches an empty editor fill in", () => {
    // Order is the assertion. The console reads the draft when it mounts, so navigating first
    // shows an empty editor that changes underneath the reader.
    const order: string[] = [];
    draftLakeQuery(
      {
        navigate: () => order.push("navigate"),
        setLakeSql: () => order.push("draft"),
        knownDivision: (id): id is DivisionId => id.length > 0,
      },
      { tenantId: "CASE-0042", sql: "select 1" },
    );
    expect(order).toEqual(["draft", "navigate"]);
  });
});

describe("the registry the panel dispatches on", () => {
  it("holds exactly the two navigate tools, so an unknown name is ignored", () => {
    // A name not here is one the browser will not act on, which is what keeps a model unable
    // to invent a client-side capability by naming one.
    expect(Object.keys(CLIENT_ACTIONS).sort()).toEqual(["draftLakeQuery", "openDivision"]);
  });
});
