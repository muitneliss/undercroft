/**
 * What a dashboard promises: while editing, its reading order can be changed as a list and
 * the change is what Save sends, and Discard returns to what is saved; a tile's foot opens
 * its question on the rows, and names a model table only when the question declares one
 * (ADR 0092: a SQL text is never parsed for a table).
 *
 * No mocks: the real route, store, router, tRPC client and react-query over an in-memory
 * server that answers the procedures named here and refuses every other
 * (`test/mountRoute.tsx`). What was saved is read off that server's ledger.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { Dashboard } from "@/routes/Dashboard.tsx";
import { useUiStore } from "@/store.ts";
import { type Answer, mountRoute } from "@/test/mountRoute.tsx";

const TENANT = "CASE-0042";
const DASHBOARD = "00000000-0000-4000-8000-00000000000d";
const REVENUE = "00000000-0000-4000-8000-000000000001";
const LEDGER = "00000000-0000-4000-8000-000000000002";
const PATH = `/tenants/${TENANT}/reports/dashboards/${DASHBOARD}`;
const WHEN = "2026-09-30T03:12:53.210Z";
const TABLE_CHART = { type: "table", y: [], options: {} };

/** Synthetic: one question built in the form over an invented table, one written as SQL. */
const QUESTIONS = [
  {
    id: REVENUE,
    name: "Doanh thu",
    definition: {
      kind: "visual",
      table: "mart_revenue",
      fields: [{ column: "month" }],
      filters: [],
      groupBy: [],
      orderBy: [],
      limit: 1000,
    },
    chart: TABLE_CHART,
    updatedAt: WHEN,
    updatedBy: "u1",
  },
  {
    id: LEDGER,
    name: "Sổ công nợ",
    definition: { kind: "sql", sql: "select month from mart_ledger" },
    chart: TABLE_CHART,
    updatedAt: WHEN,
    updatedBy: "u1",
  },
];

/** Side by side, the revenue first in reading order. */
const LAYOUT = {
  tiles: [
    { questionId: REVENUE, x: 0, y: 0, w: 4, h: 4 },
    { questionId: LEDGER, x: 4, y: 0, w: 8, h: 4 },
  ],
};

function served(role: string): Record<string, Answer> {
  return {
    "tenants.get": () => ({ tenantId: TENANT, displayName: "Acme", role }),
    "bi.questions.list": () => QUESTIONS,
    "bi.dashboards.get": () => ({
      id: DASHBOARD,
      name: "Hiệu quả kinh doanh",
      layout: LAYOUT,
      filters: [],
      updatedAt: WHEN,
      updatedBy: "u1",
    }),
    "bi.questions.answer": () => ({
      columns: [{ name: "month", type: "text" }],
      rows: [["2026-09"]],
      truncated: false,
    }),
    "bi.dashboards.save": () => ({ id: DASHBOARD }),
    "bi.dashboards.list": () => [],
  };
}

function mount(url: string, role: string): ReturnType<typeof mountRoute> {
  return mountRoute({
    pattern: "/tenants/:tenantId/reports/dashboards/:id",
    url,
    element: <Dashboard tenantId={TENANT} />,
    answers: served(role),
  });
}

afterEach(() => {
  cleanup();
  // The draft is the store's, and the store outlives a test.
  useUiStore.setState({ dashboardDraft: null });
});

/** The reading-order list's question names, in the order it prints them. */
async function readingOrder(): Promise<string[]> {
  const list = await screen.findByRole("table", { name: /theo thứ tự đọc/u });
  return within(list)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1]?.textContent ?? "");
}

describe("the reading order, while editing", () => {
  it("moves a tile later by exchanging places, and Save sends the exchanged layout", async () => {
    const { received } = mount(`${PATH}?edit=1`, "member");
    expect(await readingOrder()).toEqual(["Doanh thu", "Sổ công nợ"]);

    fireEvent.click(screen.getByRole("button", { name: "Đưa Doanh thu xuống sau" }));
    expect(await readingOrder()).toEqual(["Sổ công nợ", "Doanh thu"]);

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => {
      expect(received.map((request) => request.path)).toContain("bi.dashboards.save");
    });
    const sent = received.find((request) => request.path === "bi.dashboards.save")?.input;
    // Each takes the other's cell and size: the grid's rectangles are the author's, unchanged.
    expect(sent).toMatchObject({
      layout: {
        tiles: [
          { questionId: REVENUE, x: 4, y: 0, w: 8, h: 4 },
          { questionId: LEDGER, x: 0, y: 0, w: 4, h: 4 },
        ],
      },
    });
  });

  it("returns to the saved order on Discard", async () => {
    mount(`${PATH}?edit=1`, "member");
    await readingOrder();
    fireEvent.click(screen.getByRole("button", { name: "Đưa Sổ công nợ lên trước" }));
    expect(await readingOrder()).toEqual(["Sổ công nợ", "Doanh thu"]);

    fireEvent.click(screen.getByRole("button", { name: "Bỏ thay đổi" }));
    expect(await readingOrder()).toEqual(["Doanh thu", "Sổ công nợ"]);
    expect(screen.getByRole("button", { name: "Lưu" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("a tile's foot", () => {
  it("opens the question on its rows, and names a table only for a question built in the form", async () => {
    mount(PATH, "viewer");
    const revenue = await screen.findByRole("region", { name: "Doanh thu" });
    const ledger = screen.getByRole("region", { name: "Sổ công nợ" });

    const href = within(revenue).getByRole("link", { name: "Xem số liệu →" }).getAttribute("href");
    const opened = new URL(href ?? "", "https://undercroft.test");
    expect(opened.pathname).toBe(`/tenants/${TENANT}/reports/questions/${REVENUE}`);
    expect(opened.searchParams.get("view")).toBe("data");
    expect(opened.searchParams.get("from")).toBe(PATH);

    expect(within(revenue).getByRole("link", { name: "mart_revenue" })).toBeDefined();
    // The SQL question reads mart_ledger, and the foot does not claim to know it.
    expect(within(ledger).queryByText(/mart_ledger/u)).toBeNull();
    expect(within(ledger).getByRole("link", { name: "Xem số liệu →" })).toBeDefined();
  });
});
