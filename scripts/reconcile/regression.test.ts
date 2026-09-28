/**
 * One case per historical finding, each pinned from both sides: the defect makes the case fail,
 * and its absence lets it pass. The finding each test reproduces is named in its title, so the
 * case matrix (scripts/reconcile/docs/cases.md) can point at a test, not a memory.
 *
 * Findings reproduced elsewhere, and where:
 * - Gmail header case (`Message-Id`) read as absent -> adapters.test.ts CT-GG-003
 * - an expired access token failing every later read -> adapters.test.ts CT-GG-006/007
 * - a cached lake walk reused after a run wrote to its source -> adapters.test.ts CT-UC-006/007
 * - a cached Gmail read the live listing contradicts -> gmailSuite.test.ts IT-GM-007
 */
import { describe, expect, it } from "bun:test";

import { attachmentsCase } from "./gmailAttachments.ts";
import type { MailboxState } from "./gmailCommon.ts";
import { crossMailboxCase } from "./gmailMailbox.ts";
import { MemorySink } from "./memorySink.ts";

function mailbox(
  name: "primary" | "secondary",
  records: { id: string; messageId: string }[],
): MailboxState {
  const items = records.map((record) => ({
    source: name === "primary" ? "gmail" : "gmail.b",
    entity: "messages",
    sourceRecordId: record.id,
    payload: { id: record.id, headers: { "Message-ID": record.messageId } },
    contentSha256: "",
    observedAt: "",
    runId: "r",
    deletedAt: null,
  }));
  return {
    name,
    source: items[0]?.source ?? name,
    identityOk: true,
    identityReason: "",
    unmatchedLabels: 0,
    labels: ["INBOX"],
    fileTypes: [],
    watermark: null,
    documentsWatermark: null,
    lake: {
      items,
      pages: 1,
      exhausted: true,
      truncatedByCap: false,
      loopDetected: false,
      repeats: new Map(),
      shortBy: 0,
    },
    lakeError: null,
    byKey: new Map(),
  };
}

describe("RG regressions of historical findings", () => {
  it("RG-143 an id in both mailboxes naming different letters fails (undercroft issue #143)", () => {
    const deps = { sink: new MemorySink() };
    const clash = crossMailboxCase(deps, [
      mailbox("primary", [{ id: "aa01", messageId: "<one@example.test>" }]),
      mailbox("secondary", [{ id: "aa01", messageId: "<two@example.test>" }]),
    ]);
    expect(clash.status).toBe("FAIL");
    const same = crossMailboxCase(deps, [
      mailbox("primary", [{ id: "aa01", messageId: "<one@example.test>" }]),
      mailbox("secondary", [{ id: "aa01", messageId: "<one@example.test>" }]),
    ]);
    expect(same.status).toBe("PASS");
  });
});

describe("RG-292 attachments of a type matched only after their message was held (undercroft issue #292)", () => {
  // `image/jpg` joined the JPEG choice as an alias (v1.27.0), and a Gmail message held before
  // then is never read again, so its `image/jpg` attachments never land while the connection's
  // file types select them. Each such attachment is BLOCKED (the file types each run read are
  // not recorded), and the leg's facts count them by type.
  const message = {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX"],
    internalDate: "1",
    headerValues: {},
    parts: [
      { index: 1, mimeType: "text/plain", filename: "", size: "3", hasAttachmentId: false },
      { index: 2, mimeType: "image/jpg", filename: "scan.jpg", size: "10", hasAttachmentId: true },
      {
        index: 3,
        mimeType: "image/jpeg",
        filename: "scan2.jpeg",
        size: "20",
        hasAttachmentId: true,
      },
      // Over the connector's 25 MiB ceiling: refused by rule, never absent by fault.
      {
        index: 4,
        mimeType: "image/jpeg",
        filename: "big.jpeg",
        size: "26214401",
        hasAttachmentId: true,
      },
    ],
  };
  function judge(documents: readonly { documentId: string; contentType: string; bytes: number }[]) {
    const base = mailbox("primary", [{ id: "m1", messageId: "<m1@example.test>" }]);
    const held = {
      ...base,
      fileTypes: ["image/jpeg"],
      documentsWatermark: "2026-01-01T00:00:00Z",
      byKey: new Map([["primary:m1", base.lake?.items ?? []]]),
    };
    const read = {
      listed: new Map([["primary:m1", ["INBOX"]]]),
      complete: true,
      labels: [],
      messages: new Map([["primary:m1", message]]),
      unreadable: new Set<string>(),
    };
    const walk = {
      items: documents.map((document) => ({
        source: "gmail",
        sha256: "",
        observedAt: "",
        runId: "r",
        deletedAt: null,
        ...document,
      })),
      pages: 1,
      exhausted: true,
      truncatedByCap: false,
      loopDetected: false,
      repeats: new Map(),
      shortBy: 0,
    };
    return attachmentsCase({ sink: new MemorySink() }, held, {
      read,
      documents: { walk, error: null },
      blocker: null,
    });
  }

  it("RG-292-1 with the bug: the image/jpg attachment of a held message is BLOCKED, never a pass", () => {
    const result = judge([{ documentId: "m1:003", contentType: "image/jpeg", bytes: 20 }]);
    expect(result.counts).toMatchObject({ MATCH: 1, BLOCKED: 1, EXCLUDED_BY_RULE: 1, MISSING: 0 });
    expect(result.status).toBe("BLOCKED");
  });

  it("RG-292-2 fixed: both attachments stored, the leg passes", () => {
    const result = judge([
      { documentId: "m1:002", contentType: "image/jpg", bytes: 10 },
      { documentId: "m1:003", contentType: "image/jpeg", bytes: 20 },
    ]);
    expect(result.counts).toMatchObject({ MATCH: 2, BLOCKED: 0, EXCLUDED_BY_RULE: 1 });
    expect(result.status).toBe("PASS");
  });
});
