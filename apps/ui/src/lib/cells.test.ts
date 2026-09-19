/**
 * What a cell promises: a numeric string prints every digit it arrived with, a null is
 * visibly missing, an integer is grouped the reader's way and a double is not rounded.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { cellText } from "./cells.ts";

const vi = translatorFor("vi");
const en = translatorFor("en");
/** A number no float can hold: a numeric column, as the server sends it, as a string. */
const EXACT = "12345678901234567890.1234";

describe("cellText", () => {
  it("keeps every digit of a numeric string, marks null as missing, groups only integers", () => {
    expect(cellText(vi, EXACT, "vi")).toBe(EXACT);
    expect(cellText(vi, null, "vi")).toBe("—");
    expect(cellText(vi, 1_234_567, "vi")).toBe("1.234.567");
    expect(cellText(en, 1_234_567, "en")).toBe("1,234,567");
    expect(cellText(en, 0.123_456_789, "en")).toBe("0.123456789");
    expect(cellText(vi, true, "vi")).toBe("Có");
    expect(cellText(en, false, "en")).toBe("No");
  });
});
