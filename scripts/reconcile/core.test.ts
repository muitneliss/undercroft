/**
 * Unit cases for the reconciliation core: identity, paging, classification, and the fold
 * from results to an exit code. Offline and credential-free; every guard is pinned from both
 * sides, per `.claude/rules/tests.md`.
 */
import { describe, expect, it } from "bun:test";

import { type Keyed, reconcileLeg } from "./classify.ts";
import { gmailId, letterKey, messageKey } from "./keys.ts";
import { type FieldDiff, legStatus, summarise, type TestResult, tally } from "./model.ts";
import { walkPages } from "./paginate.ts";

describe("UT-KEY identity", () => {
  it("UT-KEY-001 a Gmail id is qualified by its mailbox, so one letter in two mailboxes is two messages", () => {
    expect(messageKey("primary", "AA00000000000A01")).toBe("primary:aa00000000000a01");
    expect(messageKey("secondary", "aa00000000000a01")).toBe("secondary:aa00000000000a01");
    expect(messageKey("primary", "aa00000000000a01")).not.toBe(
      messageKey("secondary", "aa00000000000a01"),
    );
  });

  it("UT-KEY-002 a string that is not a Gmail id yields no key rather than a wrong one", () => {
    expect(gmailId("not-an-id")).toBeNull();
    expect(gmailId("")).toBeNull();
    expect(messageKey("primary", "<abc@x>")).toBeNull();
  });

  it("UT-KEY-003 the letter key strips angle brackets and keeps case", () => {
    expect(letterKey("  <Ab.Cd@mail.example.test> ")).toBe("Ab.Cd@mail.example.test");
    expect(letterKey("<ab.cd@mail.example.test>")).not.toBe(letterKey("<Ab.Cd@mail.example.test>"));
  });

  it("UT-KEY-004 a header that is not a Message-ID yields no letter key", () => {
    expect(letterKey("")).toBeNull();
    expect(letterKey("<>")).toBeNull();
    expect(letterKey(null)).toBeNull();
  });
});

describe("UT-PAGE paging to the end", () => {
  function pages(data: string[][], cursors: (string | null)[]) {
    return (cursor: string | null) => {
      const index = cursor === null ? 0 : Number.parseInt(cursor.slice(1), 10);
      return Promise.resolve({ items: data[index] ?? [], next: cursors[index] ?? null });
    };
  }

  it("UT-PAGE-001 a listing that runs out of cursors is exhausted", async () => {
    const walk = await walkPages(pages([["a", "b"], ["c"]], ["p1", null]), {
      maxPages: 10,
      idOf: (x) => x,
    });
    expect(walk.exhausted).toBe(true);
    expect(walk.truncatedByCap).toBe(false);
    expect(walk.items).toEqual(["a", "b", "c"]);
  });

  it("UT-PAGE-002 stopping at the page cap with a cursor left is truncation, not the end", async () => {
    const walk = await walkPages(pages([["a"], ["b"], ["c"]], ["p1", "p2", null]), {
      maxPages: 2,
      idOf: (x) => x,
    });
    expect(walk.exhausted).toBe(false);
    expect(walk.truncatedByCap).toBe(true);
  });

  it("UT-PAGE-003 a cursor seen before stops the walk and says it looped", async () => {
    const walk = await walkPages(pages([["a"], ["b"]], ["p1", "p1"]), {
      maxPages: 10,
      idOf: (x) => x,
    });
    expect(walk.loopDetected).toBe(true);
    expect(walk.exhausted).toBe(false);
  });

  it("UT-PAGE-004 a record repeated across pages is kept once and counted", async () => {
    const walk = await walkPages(
      pages(
        [
          ["a", "b"],
          ["b", "c"],
        ],
        ["p1", null],
      ),
      {
        maxPages: 10,
        idOf: (x) => x,
      },
    );
    expect(walk.items).toEqual(["a", "b", "c"]);
    expect(walk.repeats.get("b")).toBe(1);
  });

  it("UT-PAGE-005 an exhausted walk short of the declared total says by how much", async () => {
    const short = await walkPages(pages([["a", "b"]], [null]), {
      maxPages: 10,
      idOf: (x) => x,
      declaredTotal: 5,
    });
    expect(short.shortBy).toBe(3);
    const whole = await walkPages(pages([["a", "b"]], [null]), {
      maxPages: 10,
      idOf: (x) => x,
      declaredTotal: 2,
    });
    expect(whole.shortBy).toBe(0);
  });
});

interface Rec {
  readonly at: number;
  readonly subject: string;
  readonly inScope?: boolean;
}

function keyed(key: string, record: Rec): Keyed<Rec> {
  return { key, record, evidence: `fixture:${key}` };
}

function subject(a: Rec, b: Rec): FieldDiff[] {
  return a.subject === b.subject
    ? []
    : [{ field: "subject", expected: a.subject, actual: b.subject }];
}

function leg(reference: Keyed<Rec>[], target: Keyed<Rec>[], extra?: { excluded?: string }) {
  return reconcileLeg<Rec, Rec>({
    reference,
    target,
    inScope: (r) => ({ inScope: r.inScope !== false, reason: "label not in scope" }),
    excludedBy: (key) => (extra?.excluded === key ? "discarded: newsletter" : null),
    synced: (r) => r.at <= 100,
    compare: subject,
  });
}

describe("UT-CLS classifying a record", () => {
  it("UT-CLS-001 present once with equal fields is a MATCH", () => {
    const [r] = leg([keyed("k", { at: 1, subject: "A" })], [keyed("k", { at: 1, subject: "A" })]);
    expect(r?.verdict).toBe("MATCH");
  });

  it("UT-CLS-002 in scope, synchronised and absent is MISSING", () => {
    const [r] = leg([keyed("k", { at: 1, subject: "A" })], []);
    expect(r?.verdict).toBe("MISSING");
  });

  it("UT-CLS-003 absent but outside the target's scope is OUT_OF_SCOPE, not missing", () => {
    const [r] = leg([keyed("k", { at: 1, subject: "A", inScope: false })], []);
    expect(r?.verdict).toBe("OUT_OF_SCOPE");
  });

  it("UT-CLS-004 absent but newer than the target's run is NOT_YET_SYNCED, not missing", () => {
    const [r] = leg([keyed("k", { at: 500, subject: "A" })], []);
    expect(r?.verdict).toBe("NOT_YET_SYNCED");
  });

  it("UT-CLS-005 absent by a declared rule is EXCLUDED_BY_RULE, whatever its age", () => {
    const [r] = leg([keyed("k", { at: 500, subject: "A" })], [], { excluded: "k" });
    expect(r?.verdict).toBe("EXCLUDED_BY_RULE");
    expect(r?.reason).toContain("newsletter");
  });

  it("UT-CLS-006 two target rows for one record is DUPLICATE, never counted as present", () => {
    const [r] = leg(
      [keyed("k", { at: 1, subject: "A" })],
      [keyed("k", { at: 1, subject: "A" }), keyed("k", { at: 1, subject: "A" })],
    );
    expect(r?.verdict).toBe("DUPLICATE");
  });

  it("UT-CLS-007 a differing preserved field is CONTENT_MISMATCH with both values", () => {
    const [r] = leg([keyed("k", { at: 1, subject: "A" })], [keyed("k", { at: 1, subject: "B" })]);
    expect(r?.verdict).toBe("CONTENT_MISMATCH");
    expect(r?.diffs).toEqual([{ field: "subject", expected: "A", actual: "B" }]);
  });

  it("UT-CLS-008 a target record with no reference is EXTRA", () => {
    const results = leg([], [keyed("x", { at: 1, subject: "A" })]);
    expect(results.map((r) => r.verdict)).toEqual(["EXTRA"]);
  });

  it("UT-CLS-009 a difference on a record changed after the target's run is lag, not a mismatch", () => {
    const [late] = leg(
      [keyed("k", { at: 500, subject: "A" })],
      [keyed("k", { at: 1, subject: "B" })],
    );
    expect(late?.verdict).toBe("NOT_YET_SYNCED");
    expect(late?.diffs).toEqual([{ field: "subject", expected: "A", actual: "B" }]);
    const [settled] = leg(
      [keyed("k", { at: 50, subject: "A" })],
      [keyed("k", { at: 1, subject: "B" })],
    );
    expect(settled?.verdict).toBe("CONTENT_MISMATCH");
  });

  it("UT-CLS-010 present although outside the declared scope is EXTRA, exposing a wrong scope model", () => {
    const [r] = leg(
      [keyed("k", { at: 1, subject: "A", inScope: false })],
      [keyed("k", { at: 1, subject: "A" })],
    );
    expect(r?.verdict).toBe("EXTRA");
  });

  it("UT-CLS-011 absent, in scope and old enough, but a condition MISSING needs has no evidence, is BLOCKED with that reason", () => {
    const results = reconcileLeg<Rec, Rec>({
      reference: [keyed("k", { at: 1, subject: "A" }), keyed("n", { at: 500, subject: "B" })],
      target: [],
      inScope: () => ({ inScope: true, reason: "" }),
      synced: (record) => record.at < 100,
      undecided: () => "the run's scope is not recorded",
      compare: () => [],
    });
    expect(results.map((r) => [r.key, r.verdict, r.reason])).toEqual([
      ["k", "BLOCKED", "the run's scope is not recorded"],
      ["n", "NOT_YET_SYNCED", "newer than the target's last completed run"],
    ]);
    expect(legStatus(tally(results), true).status).toBe("BLOCKED");
  });

  it("UT-CLS-012 a target-only record is judged by the leg when it can say more than EXTRA", () => {
    const results = reconcileLeg<Rec, Rec>({
      reference: [],
      target: [keyed("kept", { at: 1, subject: "A" }), keyed("odd", { at: 1, subject: "B" })],
      inScope: () => ({ inScope: true, reason: "" }),
      synced: () => true,
      compare: () => [],
      judgeExtra: (key) =>
        key === "kept"
          ? { verdict: "OUT_OF_SCOPE", reason: "retained by policy" }
          : { verdict: "BLOCKED", reason: "no history" },
    });
    expect(results.map((r) => [r.key, r.verdict])).toEqual([
      ["kept", "OUT_OF_SCOPE"],
      ["odd", "BLOCKED"],
    ]);
  });

  it("UT-STAT-006 a defect outranks an undecided record; undecided outranks a clean leg", () => {
    const blocked = { key: "b", verdict: "BLOCKED" as const, reason: "", diffs: [], evidence: {} };
    const missing = { ...blocked, key: "m", verdict: "MISSING" as const };
    expect(legStatus(tally([blocked, missing]), true).status).toBe("FAIL");
    expect(legStatus(tally([blocked]), true).status).toBe("BLOCKED");
  });
});

function result(status: TestResult["status"]): TestResult {
  return {
    id: "X",
    title: "x",
    group: "unit",
    source: "system",
    requirement: "",
    contract: "",
    preconditions: "",
    expected: "",
    actual: "",
    status,
    reason: "",
    evidence: [],
  };
}

describe("UT-STAT folding results into a run verdict", () => {
  it("UT-STAT-001 all PASS or OUT_OF_SCOPE is complete and exits 0", () => {
    const s = summarise([result("PASS"), result("OUT_OF_SCOPE")]);
    expect(s.complete).toBe(true);
    expect(s.exitCode).toBe(0);
  });

  it("UT-STAT-002 PENDING or BLOCKED is incomplete and exits 2, never a pass", () => {
    expect(summarise([result("PASS"), result("PENDING")]).exitCode).toBe(2);
    expect(summarise([result("PASS"), result("BLOCKED")]).complete).toBe(false);
  });

  it("UT-STAT-003 a FAIL exits 1 even when other cases could not run", () => {
    expect(summarise([result("BLOCKED"), result("FAIL")]).exitCode).toBe(1);
  });

  it("UT-STAT-004 a leg with a defect fails; with none but an unfinished target it is PENDING", () => {
    const records = leg([keyed("a", { at: 1, subject: "A" })], []);
    expect(legStatus(tally(records), true).status).toBe("FAIL");
    const clean = leg([keyed("a", { at: 1, subject: "A" })], [keyed("a", { at: 1, subject: "A" })]);
    expect(legStatus(tally(clean), false).status).toBe("PENDING");
    expect(legStatus(tally(clean), true).status).toBe("PASS");
  });

  it("UT-STAT-005 an empty comparison is never a PASS", () => {
    expect(legStatus(tally([]), true).status).toBe("OUT_OF_SCOPE");
  });
});
