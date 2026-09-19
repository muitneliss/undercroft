/**
 * `unverified` must stay its own outcome.
 *
 * `.claude/rules/data-integrity.md` is explicit that refusing to compare is a
 * correct answer and that `unverified` must not be collapsed into either of the
 * other two "to make a caller's branching simpler". A UI is a caller, and the
 * tempting simplification is a boolean `ok` — which turns "we had nothing to
 * compare against" into either a pass or a failure. Both are claims nobody made.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { presentVerdict, type Verdict } from "./verdict.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");

describe("presentVerdict", () => {
  it("renders three genuinely different states", () => {
    const tones = (["ok", "mismatch", "unverified"] as const).map(
      (v) => presentVerdict(en, v).tone,
    );

    expect(new Set(tones).size).toBe(3);
  });

  it("unverified is neither the pass nor the failure treatment", () => {
    const unverified = presentVerdict(en, "unverified");

    expect(unverified.tone).not.toBe(presentVerdict(en, "ok").tone);
    expect(unverified.tone).not.toBe(presentVerdict(en, "mismatch").tone);
  });

  it("unverified says no evidence was found, not that a check is pending", () => {
    // "Pending" or "Unknown" would imply it resolves itself later. It does not -- and the
    // Vietnamese wording has to keep that distinction, which is the half a translation is
    // most likely to lose. "Chưa kiểm chứng" is "not verified", not "đang chờ" ("pending").
    expect(presentVerdict(en, "unverified").label).toBe("Not verified");
    expect(presentVerdict(en, "unverified").description).toMatch(/not a match/iu);
    expect(presentVerdict(vi, "unverified").label).toBe("Chưa kiểm chứng");
    expect(presentVerdict(vi, "unverified").description).toMatch(/không có nghĩa là khớp/iu);
  });

  it("every state carries a word and an icon in both languages, never colour alone", () => {
    for (const verdict of ["ok", "mismatch", "unverified"] as const) {
      for (const t of [en, vi]) {
        const presented = presentVerdict(t, verdict);
        expect(presented.label).not.toBe("");
        expect(presented.icon).not.toBe("");
      }
    }
  });

  it("an unrecognised verdict throws rather than rendering as a pass", () => {
    expect(() => presentVerdict(en, "probably fine" as Verdict)).toThrow(/unhandled verdict/u);
  });
});
