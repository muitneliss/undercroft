/**
 * The language moves; the clock does not.
 *
 * `when.ts` gained a locale, and the hazard that arrived with it is specific: the obvious
 * "make dates local" change would drop `timeZone: "Asia/Singapore"` and render a Vietnamese
 * reader's expiry an hour earlier than the cron beside it fires. That is how somebody
 * concludes a grant has a day longer than it has, and nothing raises. So the zone is pinned
 * here against a locale that is NOT Singapore's.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { expiryNote, formatDate, formatDuration, lastUsedNote, relativeTime } from "./when.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");
const NOW = new Date("2026-09-17T12:00:00Z");

// The decision under test is ours -- which unit fits, and the figure in it -- and the
// abbreviation is CLDR's, which has moved between ICU builds ("2 min" on one, "2 mins" on
// another). Pinning the digits and the unit family holds the promise on both.
const TWELVE_SECONDS = /^12 secs?$/u;
const TWO_MINUTES = /^2 mins?$/u;
const NINETY_MINUTES = /^1\.5 hrs?$/u;

describe("formatDate", () => {
  it("changes language without changing timezone", () => {
    // 16:30 UTC on the 17th is 00:30 on the 18th in Singapore (UTC+8), but still 23:30 on
    // the 17th in Vietnam (UTC+7) and 16:30 on the 17th in UTC. The instant has to sit in
    // that one hour: an hour later it is the 18th in Vietnam too, and a formatter that
    // followed the locale's region or the host's zone would pass on a Hanoi laptop.
    const late = "2026-09-17T16:30:00Z";

    expect(formatDate(late, "en")).toContain("18");
    expect(formatDate(late, "vi")).toContain("18");
    expect(formatDate(late, "en")).not.toContain("17");
    expect(formatDate(late, "vi")).not.toContain("17");
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

describe("relativeTime", () => {
  it("says how long ago in the reader's language, from the same instant", () => {
    const fiveMinutesAgo = "2026-09-17T11:55:00Z";

    expect(relativeTime(fiveMinutesAgo, "en", NOW)).toBe("5 minutes ago");
    expect(relativeTime(fiveMinutesAgo, "vi", NOW)).toBe("5 phút trước");
    expect(relativeTime("2026-09-16T09:00:00Z", "en", NOW)).toBe("yesterday");
  });

  it("past a month it is the date, in the fixed zone, not a count of days", () => {
    // 17:30 UTC on 1 August is 01:30 on the 2nd in Singapore, whichever language reads it --
    // and 00:30 in Vietnam, 17:30 in UTC. The clock reading is what tells the zones apart; a
    // bare "02" would match the year 2026 whatever zone the date was rendered in.
    const long = "2026-08-01T17:30:00Z";

    expect(relativeTime(long, "en", NOW)).toContain("01:30");
    expect(relativeTime(long, "vi", NOW)).toContain("01:30");
    expect(relativeTime(long, "en", NOW)).not.toContain("ago");
  });

  it("an unreadable instant is missing, never 'now'", () => {
    expect(relativeTime("not a date", "vi", NOW)).toBe("—");
    expect(relativeTime(null, "vi", NOW)).toBe("—");
  });
});

describe("lastUsedNote", () => {
  it("a key never used says so in words; one used says how long ago", () => {
    expect(lastUsedNote(vi, "vi", null, NOW)).toBe("Chưa dùng lần nào");
    expect(lastUsedNote(en, "en", null, NOW)).toBe("Never used");
    expect(lastUsedNote(en, "en", "2026-09-17T11:55:00Z", NOW)).toBe("5 minutes ago");
  });
});

describe("formatDuration", () => {
  it("says how long a run took in the reader's language, in the unit that fits", () => {
    const start = "2026-09-17T11:00:00Z";

    expect(formatDuration(start, "2026-09-17T11:00:12Z", "en")).toMatch(TWELVE_SECONDS);
    expect(formatDuration(start, "2026-09-17T11:00:12Z", "vi")).toBe("12 giây");
    expect(formatDuration(start, "2026-09-17T11:02:00Z", "en")).toMatch(TWO_MINUTES);
    expect(formatDuration(start, "2026-09-17T12:30:00Z", "en")).toMatch(NINETY_MINUTES);
  });

  it("a run still in progress has no duration", () => {
    // MISSING, not a count that is still growing.
    expect(formatDuration("2026-09-17T11:00:00Z", null, "vi")).toBe("—");
  });
});
