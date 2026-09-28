/**
 * Every event the worker writes reads as a whole sentence, in either language, and an absent
 * count is MISSING rather than a zero.
 */

import { describe, expect, test as it } from "bun:test";

import type { RunEventView } from "@/api/types.ts";
import { translatorFor } from "@/i18n/index.ts";
import { MISSING } from "@/lib/money.ts";

import { eventSentence } from "./runEventSentence.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");

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

  it("names the scope a list was not read for, and says reconnecting grants it", () => {
    // The only place a reader learns why items has no count (ADR 0073). Rendered as
    // "Event entity_not_granted." it would say nothing about what to do.
    const skipped = event("entity_not_granted", { scope: "accounting.settings.read" }, "items");
    expect(eventSentence(en, "en", skipped)).toBe(
      "items was not read: this connection's grant lacks accounting.settings.read. Reconnect to grant accounting.settings.read.",
    );
    expect(eventSentence(vi, "vi", skipped)).toBe(
      "Không đọc items: quyền đã cấp cho kết nối này thiếu accounting.settings.read. Hãy kết nối lại để cấp accounting.settings.read.",
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
