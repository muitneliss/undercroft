/**
 * The browser's half of the fold, pinned against the database's.
 *
 * `raw.fold` in `190_raw_search.sql` is what MATCHED the hit; this is what HIGHLIGHTS it. Two
 * implementations of one idea is a drift hazard, so what is pinned here is the property that
 * has to hold for the highlight to land on the right characters: the same folding, and the
 * same length. `packages/db/src/rawSearch.test.ts` pins the SQL side of exactly that.
 */

import { describe, expect, test as it } from "bun:test";

import { fold, highlightSegments } from "./fold.ts";

describe("fold", () => {
  it("strips Vietnamese diacritics and lowercases, as raw.fold does", () => {
    expect(fold("Hợp Đồng Thuê Nhà")).toBe("hop dong thue nha");
  });

  it("folds đ and Đ, which no Unicode decomposition touches", () => {
    expect(fold("Đường Đi Đẹp")).toBe("duong di dep");
  });

  it("is length-preserving, which is what lets an offset in the fold index the original", () => {
    const corpus = [
      "àáảãạăằắẳẵặâầấẩẫậ èéẻẽẹêềếểễệ ìíỉĩị",
      "òóỏõọôồốổỗộơờớởỡợ ùúủũụưừứửữự ỳýỷỹỵ đ",
      "ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ ÈÉẺẼẸÊỀẾỂỄỆ ÌÍỈĨỊ",
      "ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ ÙÚỦŨỤƯỪỨỬỮỰ ỲÝỶỸỴ Đ",
      "Hợp đồng số 42/2026/HĐ-MB ký ngày 01/03.",
    ];
    for (const line of corpus) {
      expect(fold(line)).toHaveLength(line.normalize("NFC").length);
    }
  });

  it("leaves a string with nothing to fold alone but for case", () => {
    expect(fold("Invoice INV-001 due 2026-03-01")).toBe("invoice inv-001 due 2026-03-01");
  });
});

describe("highlightSegments", () => {
  it("marks the query's word where it occurs, in the text's own diacritics", () => {
    const segments = highlightSegments("Điều khoản Hợp đồng thuê nhà", "hop dong");
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(["Hợp", "đồng"]);
    expect(segments.map((s) => s.text).join("")).toBe("Điều khoản Hợp đồng thuê nhà");
  });

  it("marks a term typed WITH diacritics just the same", () => {
    const segments = highlightSegments("Điều khoản Hợp đồng", "Hợp");
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(["Hợp"]);
  });

  it("never loses or reorders a character of the original", () => {
    // The property that matters more than which words are marked: a highlighter that drops a
    // character is rewriting the document on screen.
    const text = "Hợp đồng số 42/2026/HĐ-MB — bên thuê trả tiền trước ngày 05.";
    const joined = highlightSegments(text, "hop dong 42")
      .map((s) => s.text)
      .join("");
    expect(joined).toBe(text);
  });

  it("marks nothing when no term occurs, rather than guessing at a span", () => {
    // The quiet side. `contract` matches `contracts` through Postgres's English stemmer, so a
    // real hit can hold no literal term; marking a nearby word would tell the reader the match
    // was somewhere it was not.
    const segments = highlightSegments("Two signed contracts were returned.", "invoice");
    expect(segments.filter((s) => s.match)).toEqual([]);
    expect(segments.map((s) => s.text).join("")).toBe("Two signed contracts were returned.");
  });

  it("ignores the websearch operators rather than hunting for them as words", () => {
    // A reader who typed `"hop dong" -phu` meant a phrase and an exclusion, not three words
    // one of which begins with a quotation mark.
    const segments = highlightSegments("Hợp đồng thuê nhà", '"hop dong" -phu');
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(["Hợp", "đồng"]);
  });

  it("returns the text as one unmarked segment for a blank query", () => {
    expect(highlightSegments("Hợp đồng", "   ")).toEqual([{ text: "Hợp đồng", match: false }]);
  });
});
