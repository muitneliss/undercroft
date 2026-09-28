/**
 * A run's outcome wears the grant's own four marks, and the next run is worded honestly.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { connection } from "@/test/fixtures.ts";
import {
  describeRun,
  journalEmptyBody,
  nextRunNote,
  runMark,
  runMarkLabel,
  sourceLabel,
} from "./runs.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");
const NOW = new Date("2026-09-17T12:00:00Z");

describe("runMark", () => {
  it("maps the three outcomes and the absence of one onto the four geometries", () => {
    expect(runMark("ok")).toBe("granted");
    expect(runMark("running")).toBe("pending");
    expect(runMark("failed")).toBe("lapsed");
    expect(runMark(null)).toBe("absent");
  });

  it("words each mark in the reader's language", () => {
    expect(runMarkLabel(vi, null)).toBe("Chưa chạy");
    expect(runMarkLabel(en, "failed")).toBe("Failed");
    expect(runMarkLabel(vi, "running")).not.toBe(runMarkLabel(en, "running"));
  });
});

describe("nextRunNote", () => {
  it("a future due time is printed as a date in the fixed zone", () => {
    // 17:30 UTC is 01:30 the next day in Singapore, in either language.
    const note = nextRunNote(
      en,
      "en",
      { cadence: "daily", nextRunAt: "2026-09-17T17:30:00Z" },
      NOW,
    );
    expect(note).toContain("18");
    expect(note).toContain("01:30");
  });

  it("a due time already past means the scheduler's next tick, not a missed run", () => {
    expect(
      nextRunNote(vi, "vi", { cadence: "hourly", nextRunAt: "2026-09-17T11:00:00Z" }, NOW),
    ).toBe("Ở lượt kế tiếp, trong vòng 5 phút");
  });

  it("paused says so; no due time at all is missing", () => {
    expect(nextRunNote(en, "en", { cadence: "paused", nextRunAt: null }, NOW)).toBe(
      "Not while paused",
    );
    expect(nextRunNote(en, "en", { cadence: "daily", nextRunAt: null }, NOW)).toBe("—");
  });
});

describe("describeRun", () => {
  it("names the source by the vendor's own name and the entities by the source's", () => {
    const line = describeRun(vi, { kind: "ingest", source: "hubspot", entities: ["deals"] });
    expect(line).toBe("HubSpot · deals");
    // A source this build has no name for keeps its id rather than being dropped.
    expect(describeRun(vi, { kind: "ingest", source: "demo", entities: [] })).toBe("demo");
  });

  it("a text-reading run says so, in words an ingest of the same source does not use (#309)", () => {
    const ingest = { kind: "ingest" as const, source: "drive", entities: [] };
    const extract = { ...ingest, kind: "extract" as const };
    expect(describeRun(vi, extract)).toBe("Đọc chữ tài liệu của Google Drive");
    expect(describeRun(en, extract)).toBe("Read the text of Google Drive documents");
    expect(describeRun(vi, extract)).not.toBe(describeRun(vi, ingest));
  });

  it("a build of the models is worded in the reader's language, with no source", () => {
    const run = { kind: "transform" as const, source: null, entities: [] };
    expect(describeRun(vi, run)).toBe("Dựng mô hình");
    expect(describeRun(en, run)).toBe("Build the models");
    expect(describeRun(en, { ...run, kind: "build" })).toBe("Try one model");
  });
});

describe("sourceLabel", () => {
  const first = connection("gmail", { status: "connected", externalAccountLabel: "ops@acme.test" });
  const second = connection("gmail.3fa9c1d2e0ab", {
    status: "connected",
    externalAccountLabel: "sales@acme.test",
  });

  it("two mailboxes of one tenant are told apart by address", () => {
    // Otherwise the journal reads "Gmail · messages" twice and nobody can say whose run failed.
    expect(sourceLabel("gmail", [first, second])).toBe("Gmail · ops@acme.test");
    expect(sourceLabel("gmail.3fa9c1d2e0ab", [first, second])).toBe("Gmail · sales@acme.test");
  });

  it("a tenant with one mailbox reads the vendor's name alone", () => {
    expect(sourceLabel("gmail", [first, connection("drive")])).toBe("Gmail");
  });
});

describe("journalEmptyBody", () => {
  it("teaches when the first run comes, from the earliest due source", () => {
    const body = journalEmptyBody(
      en,
      "en",
      [{ nextRunAt: "2026-09-18T02:00:00Z" }, { nextRunAt: "2026-09-17T17:30:00Z" }],
      NOW,
    );
    // 17:30 UTC is 01:30 the next day in Singapore.
    expect(body).toContain("01:30");
    expect(body).toContain("Run now");
  });

  it("a source already due says the next tick; no source ready says where to go", () => {
    expect(journalEmptyBody(vi, "vi", [{ nextRunAt: "2026-09-17T11:00:00Z" }], NOW)).toContain(
      "15 phút",
    );
    expect(journalEmptyBody(en, "en", [{ nextRunAt: null }], NOW)).toBe(
      "No source is ready to run. Connect one and choose what to sync under Sources.",
    );
  });
});
