/**
 * The journal with one run open, as a picture: Demo Co.'s ledger, and run 0101's leaf hinged
 * under its row -- its facts with the Target, its flow, its counts per entity and the doors to
 * the account's other runs. Demo Co. holds seven accounts, so the account select stands above
 * the ledger. Read by an admin, whose counts open the records they counted. ADR 0099.
 *
 * And the same book read as a village (ADR 0116) on a busy morning: HubSpot read again and still
 * running, the models building, and the support mailbox's last run failed. The tier forces
 * reduced motion, so the picture is the settled frame: everyone already where their work is.
 */

import { describe, test as it } from "vitest";

import { CONNECTIONS, RUNS, TENANT, tenant, XERO_RUN, XERO_RUN_DETAIL } from "@/test/demoBook.ts";
import { type Answers, open, WEBGL_TIMEOUT } from "@/test/visual.tsx";

const ADDRESS = `/tenants/${TENANT}/journal/${XERO_RUN}`;
const VILLAGE = `/tenants/${TENANT}/journal?view=village`;
const [LATEST] = RUNS.items;

const ANSWERS: Answers = {
  "tenants.get": tenant("admin"),
  "connections.list": CONNECTIONS,
  "runs.list": RUNS,
  "runs.get": XERO_RUN_DETAIL,
  "runs.events": [],
};

describe("the journal with a run open", () => {
  it("at 1440 px", { timeout: WEBGL_TIMEOUT }, async () => {
    await open(ADDRESS, "en", ANSWERS).matches("journal-run-en-1440", 1440);
  });

  it("at 390 px", { timeout: WEBGL_TIMEOUT }, async () => {
    await open(ADDRESS, "en", ANSWERS).matches("journal-run-en-390", 390);
  });
});

const VILLAGE_ANSWERS: Answers = {
  ...ANSWERS,
  "runs.list": {
    items: [
      ...(LATEST === undefined
        ? []
        : [
            {
              ...LATEST,
              id: "run-0108",
              kind: "transform" as const,
              source: null,
              entities: [],
              trigger: "build" as const,
              status: "running" as const,
              startedAt: "2026-09-29T09:29:00Z",
              endedAt: null,
              counts: null,
            },
            {
              ...LATEST,
              id: "run-0107",
              source: "hubspot",
              entities: ["deals"],
              status: "running" as const,
              startedAt: "2026-09-29T09:28:00Z",
              endedAt: null,
              counts: null,
            },
          ]),
      ...RUNS.items,
    ],
    nextCursor: null,
  },
};

describe("the journal as a village", () => {
  it("at 1440 px", { timeout: WEBGL_TIMEOUT }, async () => {
    await open(VILLAGE, "en", VILLAGE_ANSWERS).matches("journal-village-en-1440", 1440);
  });

  it("at 390 px", { timeout: WEBGL_TIMEOUT }, async () => {
    await open(VILLAGE, "vi", VILLAGE_ANSWERS).matches("journal-village-vi-390", 390);
  });
});
