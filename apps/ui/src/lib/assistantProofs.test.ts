/**
 * The sentence a reader strikes.
 *
 * What earns these tests is that the sentence is the ONLY thing standing between a reader and
 * an action they did not intend: it must describe the action with the real arguments in it, in
 * their own language, and it must come from the catalogue rather than from the model. A
 * sentence with a blank where the source should be is one somebody strikes anyway.
 */

import { describe, expect, test as it } from "bun:test";
import i18next from "i18next";

import "@/i18n/index.ts";
import { PRIVILEGED_TOOLS, proofSentence, proofValues } from "@/lib/assistantProofs.ts";

const t = i18next.getFixedT("vi");

describe("the proof sentence", () => {
  it("names the action and its real arguments, in Vietnamese", () => {
    // Vietnamese because `vi` is the default locale, which is a product decision (ADR 0012)
    // and not a fallback.
    expect(proofSentence(t, "runIngestNow", { tenantId: "CASE-0042", source: "xero" })).toBe(
      "Chạy đồng bộ nguồn xero cho khách hàng CASE-0042 ngay bây giờ.",
    );
  });

  it("interpolates every argument it promises, leaving no blanks", () => {
    // Each input is exactly the arguments that tool's sentence promises (the setCadence
    // sentence names no customer, so its input carries none), which is what lets the loop
    // below demand every one of them back.
    for (const [tool, input] of [
      ["runIngestNow", { tenantId: "CASE-0042", source: "xero" }],
      ["setCadence", { source: "gmail", cadence: "daily" }],
      ["invitePerson", { tenantId: "CASE-0042", email: "a@example.test", role: "member" }],
    ] as const) {
      const said = proofSentence(t, tool, input);
      // Every value, in the sentence. A misspelt `pick` name answers "" rather than a
      // `{{...}}`, so the blank it leaves is invisible to any check for a placeholder.
      for (const value of Object.values(input)) {
        expect(said).toContain(value);
      }
      // No `{{...}}` left unresolved, and not the key itself: both render as a sentence a
      // reader would strike without understanding it.
      expect(said).not.toContain("{{");
      expect(said).not.toContain("assistant.proof");
    }
  });

  it("answers null for a tool that declares no sentence, rather than inventing one", () => {
    expect(proofSentence(t, "sourceStatus", {})).toBeNull();
  });
});

describe("the arguments shown beside it", () => {
  it("are strings, whatever the model sent", () => {
    expect(proofValues({ source: "xero", limit: 20, on: true })).toEqual({
      source: "xero",
      limit: "20",
      on: "true",
    });
  });

  it("are empty rather than thrown for a non-object, which a model can send", () => {
    expect(proofValues(null)).toEqual({});
    expect(proofValues("nonsense")).toEqual({});
  });
});

describe("the privileged tier makes the reader retype the object", () => {
  it("every privileged tool names an argument to retype", () => {
    // The gate is worth nothing if a tool joins the tier without naming what to type back:
    // `Proof.tsx` would find no argument, conclude nothing needs typing, and hand the reader a
    // one-click strike on the one action that must not have one.
    for (const [tool, argument] of Object.entries(PRIVILEGED_TOOLS)) {
      expect(argument).not.toBe("");
      // And the argument must be one the proof's own sentence prints, or the reader is asked
      // to retype something the slip never showed them.
      const said = proofSentence(t, tool, { [argument]: "THE-OBJECT", tenantId: "CASE-0042" });
      expect(said).toContain("THE-OBJECT");
    }
  });

  it("the tier is not empty, so the assertion above is not vacuous", () => {
    expect(Object.keys(PRIVILEGED_TOOLS).length).toBeGreaterThan(0);
  });

  it("a routine write is NOT in it: a one-click strike is right for a reversible action", () => {
    // The quiet half. If every mutation demanded retyping, "run the ingest now" would cost a
    // reader more than clicking the button it replaces, and they would stop using the panel.
    expect(PRIVILEGED_TOOLS.runIngestNow).toBeUndefined();
    expect(PRIVILEGED_TOOLS.setCadence).toBeUndefined();
  });
});
