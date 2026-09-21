/**
 * Reading a turn: what was said, which parts are figures, and whether a result survived.
 *
 * These are the four decisions the interleaf makes about every message it draws, and they are
 * pure, so they are tested as values rather than through a render. What earns each test is a
 * reader-visible failure: a sentence set one paragraph per syllable, a figure numbered wrong
 * two questions later, or -- the one that matters most -- a digest drawn as though it were the
 * payload, which would show the reader a result the server deliberately did not keep.
 */

import { describe, expect, test as it } from "bun:test";

import {
  type AssistantTurn,
  figureKey,
  figureNumbers,
  figuresIn,
  outcomeOf,
  textOf,
  toolNameOf,
} from "@/lib/assistantTurns.ts";

function turn(role: string, parts: AssistantTurn["parts"]): AssistantTurn {
  return { id: "m1", role, parts };
}

describe("what was said", () => {
  it("joins the deltas a provider streamed into one sentence", () => {
    // A provider sends a sentence in pieces. Rendering one element per part would set a
    // paragraph per syllable, which is what this join exists to prevent.
    const said = textOf(
      turn("assistant", [
        { type: "text", text: "Có 2 hoá đ" },
        { type: "text", text: "ơn đã về." },
      ]),
    );
    expect(said).toBe("Có 2 hoá đơn đã về.");
  });

  it("ignores everything that is not text, including a part kind it has never seen", () => {
    // Read structurally on purpose: the SDK's part union grows, and an unknown kind must be
    // skipped rather than crash the panel a reader is mid-conversation in.
    const said = textOf(
      turn("assistant", [
        { type: "step-start" },
        { type: "text", text: "Xong." },
        { type: "some-future-part" },
      ]),
    );
    expect(said).toBe("Xong.");
  });
});

describe("which parts are figures", () => {
  it("finds a tool part under either spelling the SDK uses", () => {
    const found = figuresIn(
      turn("assistant", [
        { type: "text", text: "..." },
        { type: "tool-sourceStatus", toolCallId: "c1" },
        { type: "dynamic-tool", toolName: "whatever", toolCallId: "c2" },
      ]),
    );
    expect(found.map((part) => part.toolCallId)).toEqual(["c1", "c2"]);
  });

  it("names the tool from either spelling, because the caption says which was run", () => {
    expect(toolNameOf({ type: "tool-recentRuns" })).toBe("recentRuns");
    expect(toolNameOf({ type: "dynamic-tool", toolName: "recentRuns" })).toBe("recentRuns");
  });

  it("keys a figure by its call id, not its position in a list that is still growing", () => {
    // Keying a streaming list by index is how React reuses the wrong element as parts arrive.
    expect(figureKey({ type: "tool-x", toolCallId: "c9" }, 0)).toBe("c9");
    expect(figureKey({ type: "tool-x" }, 3)).toBe("tool-x-3");
  });
});

describe("figure numbers run across the conversation", () => {
  it("numbers from the front, so 'see figure 2' still means figure 2 later on", () => {
    // A manual numbers its figures once from the front rather than per page. Restarting per
    // turn would silently renumber every figure the reader has already been told about.
    const turns = [
      turn("user", [{ type: "text", text: "?" }]),
      turn("assistant", [
        { type: "tool-a", toolCallId: "1" },
        { type: "tool-b", toolCallId: "2" },
      ]),
      turn("user", [{ type: "text", text: "?" }]),
      turn("assistant", [{ type: "tool-c", toolCallId: "3" }]),
    ];
    // The first figure number of each turn: turn 2 opens at 1, turn 4 opens at 3.
    expect(figureNumbers(turns)).toEqual([1, 1, 3, 3]);
  });
});

describe("whether the result survived", () => {
  it("a real payload is shown", () => {
    const outcome = outcomeOf({
      type: "tool-sourceStatus",
      state: "output-available",
      output: [{ source: "xero" }],
    });
    expect(outcome).toEqual({ kind: "shown", output: [{ source: "xero" }] });
  });

  it("a digest is NOT shown, and carries the summary the tool declared safe", () => {
    // The promise that matters most here. A digest drawn as though it were the payload would
    // show the reader `{kept: false}` rendered as data -- a result the server deliberately did
    // not keep, presented as one it did.
    const outcome = outcomeOf({
      type: "tool-lakeRecords",
      state: "output-available",
      output: { kept: false, summary: "2 rows" },
    });
    expect(outcome).toEqual({ kind: "not-kept", summary: "2 rows" });
  });

  it("a digest with nothing safe to say says nothing, rather than inventing a summary", () => {
    const outcome = outcomeOf({
      type: "tool-lakeQuery",
      state: "output-available",
      output: { kept: false },
    });
    expect(outcome).toEqual({ kind: "not-kept" });
  });

  it("a failure whose words were not kept is told apart from one whose were", () => {
    // Two different sentences for the reader: "this failed and we did not keep why" is not the
    // same as a live error, and collapsing them would report a stale failure as a fresh one.
    expect(
      outcomeOf({
        type: "tool-x",
        state: "output-error",
        errorText: "undercroft:error-not-kept",
      }),
    ).toEqual({ kind: "not-kept-failed" });

    expect(
      outcomeOf({ type: "tool-x", state: "output-error", errorText: "FORBIDDEN: no" }),
    ).toEqual({ kind: "failed", why: "FORBIDDEN: no" });
  });

  it("a call still in flight is pending, so nothing is drawn for it yet", () => {
    expect(outcomeOf({ type: "tool-x", state: "input-available" }).kind).toBe("pending");
    expect(outcomeOf({ type: "tool-x", state: "input-streaming" }).kind).toBe("pending");
  });
});

describe("a proof awaiting the reader", () => {
  it("is a question, carrying the id their answer is keyed by", () => {
    const outcome = outcomeOf({
      type: "tool-runIngestNow",
      state: "approval-requested",
      input: { tenantId: "CASE-0042", source: "xero" },
      approval: { id: "a1" },
    });
    expect(outcome).toEqual({ kind: "awaiting", approvalId: "a1" });
  });

  it("is NOT a question when the gate already decided for them", () => {
    // The subtle one, and the reason `isAutomatic` is checked first. The SDK models a decision
    // the injection gate made -- without asking anybody -- as an approval request too, so a
    // panel that drew a proof for every request would ask the reader to confirm things that
    // were already refused on their behalf.
    const outcome = outcomeOf({
      type: "tool-runIngestNow",
      state: "approval-requested",
      input: { tenantId: "CASE-0042", source: "xero" },
      approval: { id: "a1", isAutomatic: true },
    });
    expect(outcome.kind).not.toBe("awaiting");
  });

  it("a discarded proof is struck, and carries why when there is a why", () => {
    expect(
      outcomeOf({
        type: "tool-runIngestNow",
        state: "output-denied",
        approval: { id: "a1", approved: false, reason: "not asked for" },
      }),
    ).toEqual({ kind: "denied", reason: "not asked for" });
  });
});
