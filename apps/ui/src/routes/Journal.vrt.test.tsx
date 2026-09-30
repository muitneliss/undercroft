/**
 * The journal with one run open, as a picture: Demo Co.'s ledger, and run 0101's leaf hinged
 * under its row -- its facts with the Target, its flow, its counts per entity and the doors to
 * the account's other runs. Demo Co. holds seven accounts, so the account select stands above
 * the ledger. Read by an admin, whose counts open the records they counted. ADR 0099.
 */

import { describe, test as it } from "vitest";

import { CONNECTIONS, RUNS, TENANT, tenant, XERO_RUN, XERO_RUN_DETAIL } from "@/test/demoBook.ts";
import { type Answers, open } from "@/test/visual.tsx";

const ADDRESS = `/tenants/${TENANT}/journal/${XERO_RUN}`;

const ANSWERS: Answers = {
  "tenants.get": tenant("admin"),
  "connections.list": CONNECTIONS,
  "runs.list": RUNS,
  "runs.get": XERO_RUN_DETAIL,
  "runs.events": [],
};

describe("the journal with a run open", () => {
  it("at 1440 px", async () => {
    await open(ADDRESS, "en", ANSWERS).matches("journal-run-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(ADDRESS, "en", ANSWERS).matches("journal-run-en-390", 390);
  });
});
