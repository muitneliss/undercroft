/**
 * What the lake's stream addressing promises: a URL an admin pastes opens the same stream,
 * the picker's option round-trips to the same stream, and the empty leaf says when the
 * first run comes in the reader's language.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import {
  type LakeStream,
  lakeEmptyBody,
  parseStream,
  streamFromKey,
  streamKey,
  streamLabel,
  streamParams,
  streamsOf,
} from "./lake.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");
const NOW = new Date("2026-09-17T12:00:00Z");

const DEALS: LakeStream = { kind: "records", source: "hubspot", entity: "deals" };
const MAIL: LakeStream = { kind: "documents", source: "gmail" };

describe("a stream's address", () => {
  it("survives the URL and the picker in both directions", () => {
    for (const stream of [DEALS, MAIL]) {
      expect(parseStream(new URLSearchParams(streamParams(stream)))).toEqual(stream);
      expect(streamFromKey(streamKey(stream))).toEqual(stream);
    }
  });

  it("a URL that names no stream, or half of one, opens none", () => {
    expect(parseStream(new URLSearchParams(""))).toBeNull();
    expect(parseStream(new URLSearchParams("source=hubspot"))).toBeNull();
    expect(streamFromKey("")).toBeNull();
    expect(streamFromKey("records|hubspot|")).toBeNull();
  });

  it("is worded as the vendor, then what the stream holds", () => {
    expect(streamLabel(vi, DEALS)).toBe("HubSpot · deals");
    expect(streamLabel(vi, MAIL)).toBe("Gmail · tài liệu");
    expect(streamLabel(en, MAIL)).toBe("Gmail · documents");
  });

  it("the summary lists records streams first, then document catalogues", () => {
    const streams = streamsOf({
      records: [
        { source: "hubspot", entity: "deals", records: 1, tombstoned: 0, latestObservedAt: "" },
      ],
      documents: [{ source: "gmail", documents: 1, bytes: 1, readable: 0, latestObservedAt: "" }],
    });
    expect(streams).toEqual([DEALS, MAIL]);
  });
});

describe("lakeEmptyBody", () => {
  it("says when the first run comes, or that nothing is scheduled, in the reader's words", () => {
    expect(lakeEmptyBody(vi, "vi", [{ nextRunAt: null }], NOW)).toBe(
      "Chưa có nguồn nào sẵn sàng để chạy. Hãy kết nối một nguồn và chọn dữ liệu cần đồng bộ ở mục Nguồn dữ liệu.",
    );
    expect(lakeEmptyBody(en, "en", [{ nextRunAt: "2026-09-17T14:00:00Z" }], NOW)).toContain(
      "22:00",
    );
  });
});
