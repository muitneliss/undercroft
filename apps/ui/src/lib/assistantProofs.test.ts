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
    for (const [tool, input] of [
      ["runIngestNow", { tenantId: "CASE-0042", source: "xero" }],
      ["setCadence", { tenantId: "CASE-0042", source: "gmail", cadence: "daily" }],
      ["invitePerson", { tenantId: "CASE-0042", email: "a@example.test", role: "member" }],
    ] as const) {
      const said = proofSentence(t, tool, input);
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

describe("the privileged tier", () => {
  it("is empty until the tools it guards exist, and the mechanism ships first", () => {
    // Asserted rather than assumed: the type-it-back gate is written and tested before any
    // tool needs it, so adding one is a catalogue entry plus a line here rather than a
    // confirmation flow invented under time pressure. If this ever fails, the tier arrived.
    expect(Object.keys(PRIVILEGED_TOOLS)).toEqual([]);
  });
});
