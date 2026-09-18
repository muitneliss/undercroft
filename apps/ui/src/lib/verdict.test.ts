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

import { translatorFor } from "@/i18n";
import { presentVerdict, type Verdict } from "./verdict";

const en = translatorFor("en");
const vi = translatorFor("vi");

describe("presentVerdict", () => {
  test("renders three genuinely different states", () => {
    const tones = (["ok", "mismatch", "unverified"] as const).map(
      (v) => presentVerdict(en, v).tone,
    );

    expect(new Set(tones).size).toBe(3);
  });

  test("unverified is neither the pass nor the failure treatment", () => {
    const unverified = presentVerdict(en, "unverified");

    expect(unverified.tone).not.toBe(presentVerdict(en, "ok").tone);
    expect(unverified.tone).not.toBe(presentVerdict(en, "mismatch").tone);
  });

  test("unverified says no evidence was found, not that a check is pending", () => {
    // "Pending" or "Unknown" would imply it resolves itself later. It does not -- and the
    // Vietnamese wording has to keep that distinction, which is the half a translation is
    // most likely to lose. "Chưa kiểm chứng" is "not verified", not "đang chờ" ("pending").
    expect(presentVerdict(en, "unverified").label).toBe("Not verified");
    expect(presentVerdict(en, "unverified").description).toMatch(/not a match/i);
    expect(presentVerdict(vi, "unverified").label).toBe("Chưa kiểm chứng");
    expect(presentVerdict(vi, "unverified").description).toMatch(/không có nghĩa là khớp/i);
  });

  test("every state carries a word and an icon in both languages, never colour alone", () => {
    for (const verdict of ["ok", "mismatch", "unverified"] as const) {
      for (const t of [en, vi]) {
        const presented = presentVerdict(t, verdict);
        expect(presented.label).not.toBe("");
        expect(presented.icon).not.toBe("");
      }
    }
  });

  test("an unrecognised verdict throws rather than rendering as a pass", () => {
    expect(() => presentVerdict(en, "probably fine" as Verdict)).toThrow(/unhandled verdict/);
  });
});
