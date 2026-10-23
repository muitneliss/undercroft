/**
 * The language moves the words; the reader's zone moves the clock.
 *
 * `when.ts` prints an instant in the viewer's own zone (ADR 0149), so the hazards are two. One is
 * a formatter that ignores the zone -- a fixed `timeZone`, the old Singapore rule coming back --
 * which would show a reader in Hanoi a time an hour off from the clock on their wall. The other is
 * a formatter that follows the LOCALE's region instead of the zone. So the same instant is printed
 * under two zones an hour apart, in both languages, and each suite names the zone it runs in:
 * `bun test` is UTC and a laptop is wherever it is, and a test that leaned on either would pass
 * for the wrong reason somewhere.
 */

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { enterZone, leaveZone, SINGAPORE, VIETNAM } from "@/test/zone.ts";
import {
  endOfLocalDay,
  expiryNote,
  formatDate,
  formatDuration,
  lastUsedNote,
  relativeTime,
} from "./when.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");
const NOW = new Date("2026-09-17T12:00:00Z");

// The decision under test is ours -- which unit fits, and the figure in it -- and the
// abbreviation is CLDR's, which has moved between ICU builds ("2 min" on one, "2 mins" on
// another). Pinning the digits and the unit family holds the promise on both.
const TWELVE_SECONDS = /^12 secs?$/u;
const TWO_MINUTES = /^2 mins?$/u;
const NINETY_MINUTES = /^1\.5 hrs?$/u;

describe("formatDate in Vietnam", () => {
  beforeAll(() => enterZone(VIETNAM));
  afterAll(leaveZone);

  it("is the reader's own day, whichever language reads it", () => {
    // 16:30 UTC on the 17th is 23:30 on the 17th in Vietnam (UTC+7), but already 00:30 on the
    // 18th in Singapore (UTC+8). The instant has to sit in that one hour: an hour later it is the
    // 18th in both, and a formatter fixed to Singapore would pass here for the wrong reason.
    const late = "2026-09-17T16:30:00Z";

    expect(formatDate(late, "en")).toContain("17");
    expect(formatDate(late, "vi")).toContain("17");
    expect(formatDate(late, "en")).not.toContain("18");
    expect(formatDate(late, "vi")).not.toContain("18");
    // Same instant, same day, different words for the month.
    expect(formatDate(late, "vi")).not.toBe(formatDate(late, "en"));
  });

  it("an unreadable date is reported as missing, not rendered as today", () => {
    expect(formatDate("not a date", "vi")).toBe("—");
    expect(formatDate(null, "vi")).toBe("—");
  });
});

describe("formatDate in Singapore", () => {
  beforeAll(() => enterZone(SINGAPORE));
  afterAll(leaveZone);

  it("is the next day for the same instant: the zone moves the clock, the language does not", () => {
    // The Vietnamese-language reader in Singapore sees Singapore's day. Run after the Vietnam
    // suite in the same process, this also fails if a cached formatter kept the earlier zone.
    const late = "2026-09-17T16:30:00Z";

    expect(formatDate(late, "en")).toContain("18");
    expect(formatDate(late, "vi")).toContain("18");
    expect(formatDate(late, "vi")).not.toContain("17");
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
  beforeAll(() => enterZone(VIETNAM));
  afterAll(leaveZone);

  it("says how long ago in the reader's language, from the same instant", () => {
    const fiveMinutesAgo = "2026-09-17T11:55:00Z";

    expect(relativeTime(fiveMinutesAgo, "en", NOW)).toBe("5 minutes ago");
    expect(relativeTime(fiveMinutesAgo, "vi", NOW)).toBe("5 phút trước");
    expect(relativeTime("2026-09-16T09:00:00Z", "en", NOW)).toBe("yesterday");
  });

  it("past a month it is the date on the reader's clock, not a count of days", () => {
    // 17:30 UTC on 1 August is 00:30 on the 2nd in Vietnam, whichever language reads it -- and
    // 01:30 in Singapore, 17:30 in UTC. The clock reading is what tells the zones apart; a bare
    // "02" would match the year 2026 whatever zone the date was rendered in.
    const long = "2026-08-01T17:30:00Z";

    expect(relativeTime(long, "en", NOW)).toContain("00:30");
    expect(relativeTime(long, "vi", NOW)).toContain("00:30");
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

describe("endOfLocalDay", () => {
  beforeAll(() => enterZone(VIETNAM));
  afterAll(leaveZone);

  it("is the last second of that day on the reader's clock, which the list then prints as that day", () => {
    // A grant "until the 31st" must not lapse at 07:00 on the 31st, which a day read as UTC would,
    // nor an hour early, which a day read in Singapore would for a reader in Vietnam.
    const until = endOfLocalDay("2026-10-31");

    expect(until).toBe("2026-10-31T16:59:59.000Z");
    expect(formatDate(until, "vi")).toBe(formatDate("2026-10-31T04:00:00Z", "vi"));
  });

  it("is nothing for a value that is not a calendar day, never a guessed instant", () => {
    expect(endOfLocalDay("")).toBeNull();
    expect(endOfLocalDay("31/10/2026")).toBeNull();
    expect(endOfLocalDay("2026-13-40")).toBeNull();
  });
});
