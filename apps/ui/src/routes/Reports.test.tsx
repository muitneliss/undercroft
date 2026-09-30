/**
 * What the Reports list promises: its two lists are views chosen in the address, each
 * view's plate counts the names the search matches in it -- so a match in the list not
 * shown is still visible -- and switching views keeps the search. A viewer is told the
 * access is read-only where an author would find the plate that creates.
 *
 * No mocks: the real route, router, tRPC client and react-query over an in-memory server
 * that answers the procedures named here and refuses every other (`test/mountRoute.tsx`).
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { Reports } from "@/routes/Reports.tsx";
import { mountRoute } from "@/test/mountRoute.tsx";

const TENANT = "CASE-0042";
const WHEN = "2026-09-30T03:12:53.210Z";
const CHART = { type: "line", y: [], options: {} };
const SQL = { kind: "sql", sql: "select 1 as n" };

/** Synthetic names; two questions and one dashboard mention revenue ("doanh thu"). */
const QUESTIONS = [
  { id: "q1", name: "Doanh thu theo tháng", definition: SQL, chart: CHART },
  { id: "q2", name: "Doanh thu theo nhóm", definition: SQL, chart: CHART },
  { id: "q3", name: "Công nợ", definition: SQL, chart: CHART },
].map((question) => ({ ...question, updatedAt: WHEN, updatedBy: "u1" }));

const DASHBOARDS = [
  { id: "d1", name: "Doanh thu tổng quan", layout: { tiles: [] }, filters: [] },
  { id: "d2", name: "Công nợ", layout: { tiles: [] }, filters: [] },
].map((dashboard) => ({ ...dashboard, updatedAt: WHEN, updatedBy: "u1" }));

afterEach(cleanup);

describe("the two lists", () => {
  it("count the search's matches in both, show the one the address names, and keep the search on switching", async () => {
    const { router } = mountRoute({
      pattern: "/tenants/:tenantId/reports",
      url: `/tenants/${TENANT}/reports?q=doanh%20thu`,
      element: <Reports tenantId={TENANT} />,
      answers: {
        "tenants.get": () => ({ tenantId: TENANT, displayName: "Acme", role: "viewer" }),
        "bi.questions.list": () => QUESTIONS,
        "bi.dashboards.list": () => DASHBOARDS,
      },
    });
    const views = await screen.findByRole("navigation", { name: "Xem báo cáo" });
    const dashboards = within(views).getByRole("link", { name: "Bảng điều khiển · 1" });
    expect(dashboards.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Doanh thu tổng quan" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Doanh thu theo tháng" })).toBeNull();
    expect(screen.getByText("Quyền chỉ xem")).toBeDefined();

    fireEvent.click(within(views).getByRole("link", { name: "Câu hỏi · 2" }));
    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get("view")).toBe("questions");
    });
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("doanh thu");
    const listed = within(screen.getByRole("table"))
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(listed).toEqual(["Doanh thu theo tháng", "Doanh thu theo nhóm"]);
    // The chart type is still named in words for a screen reader behind its mark.
    expect(within(screen.getByRole("table")).getAllByText("Đường")).toHaveLength(2);
  });
});
