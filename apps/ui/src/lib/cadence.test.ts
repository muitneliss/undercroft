/**
 * The cadences read as words in both languages, and a cron expression reads as the dates it
 * fires at -- never as a paraphrase of itself.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { CADENCES, describeCadence, isPresetCadence, previewCron } from "./cadence.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");

/** Sunday 1 March 2026, 18:00 in Singapore. */
const NOW = new Date("2026-03-01T10:00:00.000Z");

describe("describeCadence", () => {
  it("names every cadence in both languages, never as its stored word", () => {
    for (const cadence of CADENCES) {
      expect(describeCadence(en, cadence)).not.toBe(cadence);
      expect(describeCadence(vi, cadence)).not.toBe(cadence);
      expect(describeCadence(vi, cadence)).not.toBe(describeCadence(en, cadence));
    }
    expect(describeCadence(en, "every_6h")).toBe("Every 6 hours");
    expect(describeCadence(vi, "paused")).toBe("Tạm dừng");
  });
});

describe("isPresetCadence", () => {
  it("accepts the four presets, which save on selection, and nothing else", () => {
    expect(isPresetCadence("hourly")).toBe(true);
    expect(isPresetCadence("paused")).toBe(true);
    // Custom saves only with its expression, so the select must not send it as a preset.
    expect(isPresetCadence("custom")).toBe(false);
    expect(isPresetCadence("weekly")).toBe(false);
  });
});

describe("previewCron", () => {
  it("an expression it can keep reads as its next three fires, weekday first, in Singapore time", () => {
    const preview = previewCron(en, "en", "30 7 * * 1-5", NOW);
    expect(preview.state).toBe("ok");
    if (preview.state !== "ok") {
      return;
    }
    expect(preview.cron).toBe("30 7 * * 1-5");
    // Monday to Wednesday, 07:30 -- in Singapore, whatever zone the suite runs in.
    expect(preview.fires).toHaveLength(3);
    expect(preview.fires[0]).toContain("Mon");
    expect(preview.fires[0]).toContain("02 Mar 2026");
    expect(preview.fires[0]).toContain("07:30");
    expect(preview.fires[2]).toContain("Wed");
  });

  it("one it cannot keep reads as why, in the reader's language", () => {
    expect(previewCron(vi, "vi", "*/2 * * * *", NOW)).toEqual({
      state: "refused",
      reason: "Biểu thức này chạy dày hơn 5 phút một lần, nhanh hơn nhịp của bộ lập lịch.",
    });
    expect(previewCron(en, "en", "0 7 * *", NOW)).toEqual({
      state: "refused",
      reason: "Five fields are needed, separated by spaces.",
    });
  });

  it("nothing typed is neither a refusal nor something to save", () => {
    expect(previewCron(en, "en", "  ", NOW)).toEqual({ state: "empty" });
  });
});
