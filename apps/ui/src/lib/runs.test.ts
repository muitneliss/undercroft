/**
 * A run's outcome wears the grant's own four marks, and the next run is worded honestly.
 */

import { describe, expect, test as it } from "bun:test";

import type { RunEventView } from "@/api/types.ts";
import { translatorFor } from "@/i18n/index.ts";
import { MISSING } from "@/lib/money.ts";
import { connection } from "@/test/fixtures.ts";
import {
  describeRun,
  eventSentence,
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
    ).toBe("Ở lượt kế tiếp, trong vòng 15 phút");
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

describe("eventSentence", () => {
  function event(
    name: string,
    detail: Record<string, unknown>,
    entity: string | null = null,
  ): RunEventView {
    return {
      at: "2026-09-19T12:42:22.000Z",
      level: "info",
      event: name,
      entity,
      detail,
      live: false,
    };
  }

  it("words a run's own line in the reader's language, grouping the counts their way", () => {
    const listed = event("work_listed", { total: 12_431 }, "messages");
    expect(eventSentence(vi, "vi", listed)).toBe("Cần đọc 12.431 messages.");
    expect(eventSentence(en, "en", listed)).toBe("12,431 messages to read.");
  });

  it("says how much a run did not have to read, so a steady run is not a blank one", () => {
    // In steady state an ingest lands nothing, and `landed: 0` alone reads the same whether
    // the mailbox is empty, the credential is broken, or nothing has changed since
    // yesterday. It is a second sentence rather than a count appended to the first, because
    // a source that skips nothing sends no `skipped` and would otherwise print MISSING --
    // the quiet side, which the MISSING test below already holds.
    const held = event("work_listed", { total: 7786, skipped: 7786 }, "messages");
    expect(eventSentence(en, "en", held)).toBe(
      "7,786 messages listed, 7,786 already held and not read.",
    );
    expect(eventSentence(vi, "vi", held)).toBe(
      "Có 7.786 messages, 7.786 đã có sẵn nên không đọc lại.",
    );

    const done = event(
      "entity_done",
      { landed: 0, created: 0, changed: 0, refused: 0, skipped: 7786 },
      "messages",
    );
    expect(eventSentence(en, "en", done)).toBe(
      "Finished messages: 0 landed, 0 new, 0 changed, 0 refused, 7,786 already held and not read.",
    );
  });

  it("says why a green run built nothing, which the counts alone could not", () => {
    expect(eventSentence(vi, "vi", event("no_models", {}))).toBe(
      "Khách hàng này chưa có mô hình nào, nên không có gì để dựng.",
    );
    expect(eventSentence(en, "en", event("picks_listed", { folders: 1, matched: 0 }))).toBe(
      "Listed 1 picked folders and found 0 matching files. Sub-folders are not read.",
    );
  });

  it("says a run stopped by a deploy kept what it landed, with the counts that prove it", () => {
    // The worker writes `run_stopped` on a run it stopped on purpose (ADR 0051). Rendered as
    // "Event run_stopped." the one line meant to tell the reader nothing was lost would be the
    // one they could not read.
    const stopped = event("run_stopped", { created: 400, changed: 0, refused: 2 });
    expect(eventSentence(en, "en", stopped)).toBe(
      "Stopped part-way because the worker shut down, usually for a deploy. What it landed is kept: 400 new, 0 changed, 2 refused. The next run carries on from here.",
    );
    expect(eventSentence(vi, "vi", stopped)).toBe(
      "Dừng giữa chừng vì worker tắt, thường do triển khai bản mới. Những gì đã về được giữ lại: 400 mới, 0 đổi, 2 bị từ chối. Lần chạy sau tiếp tục từ đây.",
    );
  });

  it("a count the worker did not send is MISSING, never a zero that reads as a real one", () => {
    expect(eventSentence(en, "en", event("work_listed", {}, "files"))).toBe(
      `${MISSING} files to read.`,
    );
  });

  it("an event this release does not know renders as itself rather than vanishing", () => {
    expect(eventSentence(en, "en", event("landed_on_the_moon", {}))).toBe(
      "Event landed_on_the_moon.",
    );
  });
});
