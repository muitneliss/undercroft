/**
 * The Reports index as pictures: Demo Co.'s dashboards, as an author finds them -- with the
 * plates that create -- and as a viewer does, told the access is read-only where those plates
 * would be.
 *
 * The fixtures mirror the design review's own (`@/test/reportsBook.ts`). ADR 0099.
 */

import { describe, test as it } from "vitest";

import { TENANT } from "@/test/modelsBook.ts";
import { reportsAnswers } from "@/test/reportsBook.ts";
import { open } from "@/test/visual.tsx";

const REPORTS = `/tenants/${TENANT}/reports`;

describe("the reports index, in English, at 1440 px", () => {
  it("read by an admin", async () => {
    await open(REPORTS, "en", reportsAnswers("admin")).matches("reports-en-1440", 1440);
  });

  it("read by a viewer", async () => {
    await open(REPORTS, "en", reportsAnswers("viewer")).matches("reports-viewer-en-1440", 1440);
  });
});
