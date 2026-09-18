/**
 * `unverified` must stay its own outcome.
 *
 * `.claude/rules/data-integrity.md` is explicit that refusing to compare is a
 * correct answer and that `unverified` must not be collapsed into either of the
 * other two "to make a caller's branching simpler". A UI is a caller, and the
 * tempting simplification is a boolean `ok` — which turns "we had nothing to
 * compare against" into either a pass or a failure. Both are claims nobody made.
 */

import { describe, expect, test } from "bun:test";

import { presentVerdict, type Verdict } from "./verdict.ts";

describe("presentVerdict", () => {
  test("renders three genuinely different states", () => {
    const tones = (["ok", "mismatch", "unverified"] as const).map((v) => presentVerdict(v).tone);

    expect(new Set(tones).size).toBe(3);
  });

  test("unverified is neither the pass nor the failure treatment", () => {
    const unverified = presentVerdict("unverified");

    expect(unverified.tone).not.toBe(presentVerdict("ok").tone);
    expect(unverified.tone).not.toBe(presentVerdict("mismatch").tone);
  });

  test("unverified says no evidence was found, not that a check is pending", () => {
    // "Pending" or "Unknown" would imply it resolves itself later. It does not.
    const { label, description } = presentVerdict("unverified");

    expect(label).toBe("Not verified");
    expect(description).toMatch(/not a match/iu);
  });

  test("every state carries a word and an icon, never colour alone", () => {
    for (const verdict of ["ok", "mismatch", "unverified"] as const) {
      const presented = presentVerdict(verdict);
      expect(presented.label).not.toBe("");
      expect(presented.icon).not.toBe("");
    }
  });

  test("an unrecognised verdict throws rather than rendering as a pass", () => {
    expect(() => presentVerdict("probably fine" as Verdict)).toThrow(/unhandled verdict/u);
  });
});
