/**
 * CASE-0042, Demo Co., as the operator screens' visual tests read it: its connections, its runs,
 * what landed in its lake and who may see it.
 *
 * It mirrors the design review's own synthetic book (seven accounts over four kinds, run 0101
 * reading Xero, three members and one open invitation) so a capture can be set beside the
 * design's picture of the same screen and read line by line. Where the design's data cannot be
 * what this server answers, the server's shape wins: a further account of a kind is
 * `<kind>.<12 hex>` (ADR 0043), never the design's `gmail.operations`, and a run id is `run-…`.
 *
 * Every value is invented (`.claude/rules/pii.md`): `example.test` addresses, `Demo` names.
 * Times sit a little before `VISUAL_NOW`, which is when every capture is taken.
 *
 * Typed by the router's own outputs, so a server field renamed is a compile error here rather
 * than a screen that quietly renders a blank.
 */

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@undercroft/control-plane/router";

import type { Answers } from "@/test/visual.tsx";

type Out = inferRouterOutputs<AppRouter>;
type Connection = Out["connections"]["list"][number];
type Run = Out["runs"]["list"]["items"][number];
type Role = Out["tenants"]["get"]["role"];

export const TENANT = "CASE-0042";

/** The second Gmail mailbox and the second and third Drive accounts, as ADR 0043 names them. */
export const GMAIL_SUPPORT = "gmail.5a1e0c7d9b2f";
export const DRIVE_KNOWLEDGE = "drive.3c9d0e1f2a4b";
export const DRIVE_ARCHIVE = "drive.8e7f6a5b4c3d";

/** The run the journal opens and the lake narrows to: Xero's read of the design's run 0101. */
export const XERO_RUN = "run-0101";
/** The later Xero run that wrote one of run 0101's invoices again. */
const XERO_RERUN = "run-0107";

/** Demo Co., opened by a reader holding `role` in it. */
export function tenant(role: Role): Out["tenants"]["get"] {
  return { id: TENANT, displayName: "Demo Co.", role };
}

function lastRun(id: string, at: string, seen: number): NonNullable<Connection["lastRun"]> {
  return {
    id,
    status: "ok",
    startedAt: at,
    endedAt: at.replace(":00Z", ":40Z"),
    seen,
    refused: 0,
    error: null,
  };
}

/** One account, with the inert fields every card carries filled once. */
function account(
  over: Pick<Connection, "kind" | "source" | "status" | "externalAccountLabel"> &
    Partial<Connection>,
): Connection {
  return {
    ungranted: [],
    externalAccountId: `demo-${over.source}`,
    scopes: [],
    config: {},
    cadence: "every_6h",
    cron: null,
    nextRunAt: "2026-09-29T12:00:00Z",
    lastRun: null,
    expiresAt: null,
    resync: null,
    ...over,
  };
}

/** The seven accounts of the design's Sources screen: five connected, two needing attention. */
export const CONNECTIONS: Connection[] = [
  account({
    kind: "xero",
    source: "xero",
    status: "connected",
    externalAccountLabel: "Demo Company Pte. Ltd.",
    config: { entities: ["invoices", "contacts", "payments"] },
    lastRun: lastRun(XERO_RERUN, "2026-09-29T09:10:00Z", 1),
  }),
  account({
    kind: "hubspot",
    source: "hubspot",
    status: "connected",
    externalAccountLabel: "Demo sales workspace",
    config: { properties: { contacts: ["jobtitle"] } },
    cadence: "hourly",
    nextRunAt: "2026-09-29T10:00:00Z",
    lastRun: lastRun("run-0102", "2026-09-29T08:30:00Z", 1),
  }),
  account({
    kind: "gmail",
    source: "gmail",
    status: "connected",
    externalAccountLabel: "operations@example.test",
    config: { labels: ["INBOX", "FINANCE"], fileTypes: ["application/pdf"] },
    lastRun: lastRun("run-0103", "2026-09-29T08:20:00Z", 1),
  }),
  account({
    kind: "gmail",
    source: GMAIL_SUPPORT,
    status: "needs_reconnect",
    externalAccountLabel: "support@example.test",
    config: { labels: ["SUPPORT"], fileTypes: ["application/pdf"] },
    lastRun: {
      ...lastRun("run-0106", "2026-09-29T08:00:00Z", 0),
      status: "failed",
      error: "Demo connection needs authorization again. No new data was written.",
    },
  }),
  account({
    kind: "drive",
    source: "drive",
    status: "connected",
    externalAccountLabel: "finance@example.test",
    config: {
      files: [
        { id: "folder-finance", name: "Demo finance", kind: "folder" },
        { id: "folder-support", name: "Demo support", kind: "folder" },
      ],
      recurse: true,
      fileTypes: ["application/pdf"],
    },
    lastRun: lastRun("run-0104", "2026-09-29T08:10:00Z", 1),
  }),
  account({
    kind: "drive",
    source: DRIVE_KNOWLEDGE,
    status: "connected",
    externalAccountLabel: "knowledge@example.test",
    config: {
      files: [{ id: "folder-support", name: "Demo support", kind: "folder" }],
      recurse: false,
      fileTypes: [],
    },
    cadence: "daily",
    nextRunAt: "2026-09-30T00:00:00Z",
    lastRun: lastRun("run-0105", "2026-09-29T08:05:00Z", 1),
  }),
  account({
    kind: "drive",
    source: DRIVE_ARCHIVE,
    status: "needs_scope",
    externalAccountLabel: "archive@example.test",
    cadence: "daily",
    nextRunAt: null,
  }),
];

/** An ingest run of the ledger, ended forty seconds after it started. */
function ingest(id: string, source: string, at: string, over: Partial<Run> = {}): Run {
  return {
    id,
    kind: "ingest",
    source,
    entities: [],
    status: "ok",
    trigger: "schedule",
    startedAt: at,
    endedAt: at.replace(":00Z", ":40Z"),
    counts: { landed: 1, created: 1, changed: 0, unchanged: 0, refused: 0 },
    testsFailed: null,
    error: null,
    parentRunId: null,
    releaseTag: "v1.57.0",
    pendingBefore: null,
    ...over,
  };
}

const XERO_READ = ingest(XERO_RUN, "xero", "2026-09-29T08:39:00Z", {
  entities: ["invoices", "contacts"],
  counts: { landed: 3, created: 3, changed: 0, unchanged: 0, refused: 0 },
});

/** The ledger, newest first, as the design's journal lists it. */
export const RUNS: Out["runs"]["list"] = {
  items: [
    ingest(XERO_RERUN, "xero", "2026-09-29T09:10:00Z", {
      entities: ["invoices"],
      counts: { landed: 1, created: 0, changed: 1, unchanged: 0, refused: 0 },
    }),
    XERO_READ,
    ingest("run-0102", "hubspot", "2026-09-29T08:30:00Z", { entities: ["contacts"] }),
    ingest("run-0103", "gmail", "2026-09-29T08:20:00Z", { entities: ["documents"] }),
    ingest("run-0104", "drive", "2026-09-29T08:10:00Z", { entities: ["documents"] }),
    ingest("run-0105", DRIVE_KNOWLEDGE, "2026-09-29T08:05:00Z", { entities: ["documents"] }),
    ingest("run-0106", GMAIL_SUPPORT, "2026-09-29T08:00:00Z", {
      status: "failed",
      counts: { landed: 0, created: 0, changed: 0, unchanged: 0, refused: 0 },
      error: "Demo connection needs authorization again. No new data was written.",
    }),
  ],
  nextCursor: null,
};

/** Run 0101 in full: two invoices and a contact created, read with the scope saved that day. */
export const XERO_RUN_DETAIL: Out["runs"]["get"] = {
  ...XERO_READ,
  entityCounts: [
    { entity: "invoices", landed: 2, created: 2, changed: 0, unchanged: 0, refused: 0 },
    { entity: "contacts", landed: 1, created: 1, changed: 0, unchanged: 0, refused: 0 },
  ],
  refusals: [],
  reasonCounts: [],
  refusalsPruned: false,
  steps: [],
  parentRun: null,
  childRun: null,
  scope: { entities: ["invoices", "contacts", "payments"] },
};

/** What has landed, per stream: the design's inventory of six streams. */
export const LAKE_SUMMARY: Out["lake"]["summary"] = {
  records: [
    {
      source: "xero",
      entity: "invoices",
      records: 2,
      tombstoned: 0,
      latestObservedAt: "2026-09-29T09:10:00Z",
    },
    {
      source: "xero",
      entity: "contacts",
      records: 1,
      tombstoned: 0,
      latestObservedAt: "2026-09-29T08:39:04Z",
    },
    {
      source: "hubspot",
      entity: "contacts",
      records: 1,
      tombstoned: 0,
      latestObservedAt: "2026-09-29T08:30:00Z",
    },
  ],
  documents: [
    ["gmail", "2026-09-29T08:20:00Z"],
    ["drive", "2026-09-29T08:10:00Z"],
    [DRIVE_KNOWLEDGE, "2026-09-29T08:05:00Z"],
  ].map(([source = "", at = ""]) => ({
    source,
    documents: 1,
    distinctBlobs: 1,
    bytes: 48_213,
    readable: 1,
    refused: 0,
    waiting: 0,
    reasons: [],
    latestObservedAt: at,
  })),
};

/**
 * Xero's invoices narrowed to run 0101: one of its two still names it, because run 0107 has
 * since written the other again. The payload is the server's pretty-printed string, digits past
 * a float's reach included -- the reason the browser never parses it.
 */
export const XERO_INVOICES_OF_RUN: Out["lake"]["records"] = {
  items: [
    {
      source: "xero",
      entity: "invoices",
      sourceRecordId: "DEMO-INV-0001",
      payload: [
        "{",
        '  "InvoiceID": 9223372036854775807,',
        '  "InvoiceNumber": "DEMO-0001",',
        '  "Total": 1234.567890123456789,',
        '  "Status": "AUTHORISED"',
        "}",
      ].join("\n"),
      contentSha256: "0".repeat(64),
      sourceUpdatedAt: "2026-09-29T08:38:00Z",
      observedAt: "2026-09-29T08:39:00Z",
      loadedAt: "2026-09-29T08:39:02Z",
      runId: XERO_RUN,
      deletedAt: null,
    },
  ],
  nextCursor: null,
  ofRun: { runId: XERO_RUN, wrote: 2, current: 1, rewritten: 1 },
};

/** Three members, the operator the only admin, and one invitation still open. */
export const MEMBERS: Out["people"]["members"] = [
  { userId: "user-1", email: "operator@example.test", role: "admin" },
  { userId: "user-2", email: "analyst@example.test", role: "member" },
  { userId: "user-3", email: "reader@example.test", role: "viewer" },
];

export const INVITATIONS: Out["people"]["invitations"] = [
  {
    id: "invitation-1",
    email: "reviewer@example.test",
    role: "viewer",
    status: "pending",
    expiresAt: "2026-10-06T08:00:00Z",
  },
];

/** Everything the Sources leaf asks for, read by a reader holding `role`. */
export function sourcesAnswers(role: Role): Answers {
  return {
    "tenants.get": tenant(role),
    "connections.list": CONNECTIONS,
    "keys.list": [],
  };
}
