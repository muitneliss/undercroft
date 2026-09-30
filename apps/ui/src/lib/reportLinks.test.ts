/**
 * What the links between a dashboard and its questions promise: a tile's title carries the
 * dashboard's value for every parameter its question takes, plus the way back; the way back
 * lands on the same dashboard with the same values -- and a `from` that names anywhere else
 * is no way back at all, never a redirect out of Reports.
 */

import { describe, expect, test as it } from "bun:test";

import { paramsFromSearch } from "./params.ts";
import { dashboardBack, tileQuestionHref } from "./reportLinks.ts";

const BASE = "/tenants/CASE-0042/reports";
const DASHBOARD = `${BASE}/dashboards/6f1c2d3e-0000-4000-8000-000000000001`;

describe("tile to question and back", () => {
  it("opens the question on the dashboard's values, and leads back to the same dashboard", () => {
    const onDashboard = new URLSearchParams(
      "p.segment=Bán lẻ&p.period_from=2026-01-01&p.period_to=2026-01-31&edit=1",
    );
    const href = tileQuestionHref({
      questionPath: `${BASE}/questions/q1`,
      names: ["segment", "period_from"],
      dashboardPath: DASHBOARD,
      search: onDashboard,
    });
    const opened = new URL(href, "http://x.invalid");

    expect(opened.pathname).toBe(`${BASE}/questions/q1`);
    expect(paramsFromSearch(opened.searchParams, ["segment", "period_from", "period_to"])).toEqual({
      params: { segment: "Bán lẻ", period_from: "2026-01-01" },
      missing: ["period_to"],
    });
    expect(dashboardBack(opened.searchParams, BASE)).toEqual({
      id: "6f1c2d3e-0000-4000-8000-000000000001",
      href: `${DASHBOARD}?p.segment=B%C3%A1n+l%E1%BA%BB&p.period_from=2026-01-01&p.period_to=2026-01-31`,
    });
  });

  it("offers no way back for a from outside this tenant's dashboards", () => {
    for (const from of [
      "https://evil.example/tenants/CASE-0042/reports/dashboards/x",
      "//evil.example/tenants/CASE-0042/reports/dashboards/x",
      `${BASE}/dashboards/../../../account`,
      `${BASE}/questions/q1`,
      "/tenants/OTHER/reports/dashboards/x",
      `${BASE}/dashboards/`,
    ]) {
      expect(dashboardBack(new URLSearchParams({ from }), BASE)).toBeNull();
    }
    expect(dashboardBack(new URLSearchParams(), BASE)).toBeNull();
  });
});
