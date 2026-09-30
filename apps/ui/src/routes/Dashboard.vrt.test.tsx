/**
 * The "Business performance" dashboard as pictures: two questions over `revenue_monthly` side by
 * side under the dashboard's month range, each drawn by the app's own chart code and footed with
 * the model table it reads and the way to its rows; stacked below 760 px.
 *
 * The range is in the address, so every tile has its values and draws on arrival. The fixtures
 * mirror the design review's own (`@/test/reportsBook.ts`). ADR 0099.
 */

import { describe, test as it } from "vitest";

import { TENANT } from "@/test/modelsBook.ts";
import { DASHBOARD_ID, PERFORMANCE_RANGE, reportsAnswers } from "@/test/reportsBook.ts";
import { open } from "@/test/visual.tsx";

const DASHBOARD = `/tenants/${TENANT}/reports/dashboards/${DASHBOARD_ID.performance}?${PERFORMANCE_RANGE}`;

describe("the Business performance dashboard, in English, read by an admin", () => {
  it("at 1440 px", async () => {
    await open(DASHBOARD, "en", reportsAnswers("admin")).matches("dashboard-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(DASHBOARD, "en", reportsAnswers("admin")).matches("dashboard-en-390", 390);
  });
});
