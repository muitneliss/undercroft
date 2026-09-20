/**
 * What the lake's stream addressing promises: a URL an admin pastes opens the same stream,
 * the picker's option round-trips to the same stream, and the empty leaf says when the
 * first run comes in the reader's language.
 */

import { describe, expect, test as it } from "bun:test";

import type { RawSearchHit } from "@/api/types.ts";
import { translatorFor } from "@/i18n/index.ts";
import {
  hitNotes,
  hitWhere,
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

describe("a search hit as a reader sees it", () => {
  const record: RawSearchHit = {
    kind: "record",
    source: "hubspot",
    entity: "deals",
    sourceRecordId: "d-1",
    rank: 0.3,
    excerpt: '"deal_name":"Hợp đồng thuê nhà"',
    observedAt: "2026-09-17T12:00:00.000Z",
    deletedAt: null,
  };
  const document: RawSearchHit = {
    kind: "document",
    source: "drive",
    documentId: "f-1",
    method: "pdf_ocr",
    truncated: false,
    rank: 0.4,
    excerpt: "Hợp đồng thuê nhà",
    observedAt: "2026-09-17T12:00:00.000Z",
    deletedAt: null,
  };

  it("says where it is with the vendor's own name and the source's own ids", () => {
    expect(hitWhere(record)).toBe("HubSpot · deals · d-1");
    expect(hitWhere(document)).toBe("Google Drive · f-1");
  });

  it("a record with nothing else to say says nothing else", () => {
    // The quiet side. Notes that always appeared would be chrome a reader learns to skip,
    // and the two that matter -- OCR, and a tombstone -- would go with them.
    expect(hitNotes(vi, record, "vi")).toEqual([]);
    expect(hitNotes(en, record, "en")).toEqual([]);
  });

  it("a document says how it was read, in the reader's language", () => {
    expect(hitNotes(vi, document, "vi")).toEqual(["đọc bằng pdf_ocr"]);
    expect(hitNotes(en, document, "en")).toEqual(["read by pdf_ocr"]);
  });

  it("a document nothing could be read from says that, rather than going quiet", () => {
    const unread: RawSearchHit = { ...document, method: null };
    expect(hitNotes(vi, unread, "vi")).toEqual(["chưa đọc được nội dung"]);
    expect(hitNotes(en, unread, "en")).toEqual(["nothing could be read from it"]);
  });

  it("a document cut short at extraction says the rest was never searched", () => {
    const cut: RawSearchHit = { ...document, truncated: true };
    expect(hitNotes(en, cut, "en")).toEqual([
      "read by pdf_ocr",
      "This document was cut short when it was read, so the rest was not searched.",
    ]);
  });

  it("a hit the source has since deleted says so, in either kind", () => {
    const gone = "2026-09-18T12:00:00.000Z";
    expect(hitNotes(en, { ...record, deletedAt: gone }, "en")).toEqual(["Deleted 18 Sept 2026"]);
    expect(hitNotes(en, { ...document, deletedAt: gone }, "en")).toHaveLength(2);
  });
});
