/**
 * The language moves; the clock does not.
 *
 * `when.ts` gained a locale, and the hazard that arrived with it is specific: the obvious
 * "make dates local" change would drop `timeZone: "Asia/Singapore"` and render a Vietnamese
 * reader's expiry an hour earlier than the cron beside it fires. That is how somebody
 * concludes a grant has a day longer than it has, and nothing raises. So the zone is pinned
 * here against a locale that is NOT Singapore's.
 */

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { describeSchedule, expiryNote, formatDate } from "./when.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");
const NOW = new Date("2026-09-17T12:00:00Z");

describe("formatDate", () => {
  it("changes language without changing timezone", () => {
    // 17:30 UTC on the 17th is 01:30 on the 18th in Singapore. Vietnam is UTC+7, so a
    // formatter that quietly followed the locale's own region would say the 17th here.
    const late = "2026-09-17T17:30:00Z";

    expect(formatDate(late, "en")).toContain("18");
    expect(formatDate(late, "vi")).toContain("18");
    // Same instant, same day, different words for the month.
    expect(formatDate(late, "vi")).not.toBe(formatDate(late, "en"));
  });

  it("an unreadable date is reported as missing, not rendered as today", () => {
    expect(formatDate("not a date", "vi")).toBe("—");
    expect(formatDate(null, "vi")).toBe("—");
  });
});

describe("expiryNote", () => {
  it("a credential with no recorded expiry says so rather than showing a dash", () => {
    // A HubSpot private-app token genuinely never expires. A dash would read as missing
    // data and send someone looking for a value nobody failed to record.
    expect(expiryNote(en, null, NOW)).toBe("No expiry recorded");
    expect(expiryNote(vi, null, NOW)).toBe("Không ghi nhận hạn dùng");
  });

  it("how long ago it lapsed is in the reader's language", () => {
    const sixDaysAgo = "2026-09-11T12:00:00Z";

    expect(expiryNote(en, sixDaysAgo, NOW)).toBe("Lapsed 6 days ago");
    expect(expiryNote(vi, sixDaysAgo, NOW)).toBe("Đã hết hạn 6 ngày trước");
  });
});

describe("describeSchedule", () => {
  it("names the two shapes this product writes, in both languages", () => {
    expect(describeSchedule(en, "0 9 * * *")).toBe("Daily at 09:00 SGT");
    expect(describeSchedule(vi, "0 9 * * *")).toBe("Hằng ngày lúc 09:00 SGT");
  });

  it("shows an unrecognised expression rather than guessing at it", () => {
    // A cron translator that is subtly wrong about a schedule is worse than the five
    // fields an operator already knows how to read -- and twice as bad in two languages.
    expect(describeSchedule(vi, "*/7 3 1 * 2")).toBe("*/7 3 1 * 2");
  });
});
