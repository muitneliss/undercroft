/**
 * The four cadences read as words in both languages, and a form can send only those four.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { CADENCES, describeCadence, isCadence } from "./cadence.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");

describe("describeCadence", () => {
  it("names every preset in both languages, never as its stored word", () => {
    for (const cadence of CADENCES) {
      expect(describeCadence(en, cadence)).not.toBe(cadence);
      expect(describeCadence(vi, cadence)).not.toBe(cadence);
      expect(describeCadence(vi, cadence)).not.toBe(describeCadence(en, cadence));
    }
    expect(describeCadence(en, "every_6h")).toBe("Every 6 hours");
    expect(describeCadence(vi, "paused")).toBe("Tạm dừng");
  });
});

describe("isCadence", () => {
  it("accepts the four presets and refuses anything else a form could carry", () => {
    expect(isCadence("hourly")).toBe(true);
    expect(isCadence("paused")).toBe(true);
    expect(isCadence("weekly")).toBe(false);
    expect(isCadence("")).toBe(false);
  });
});
