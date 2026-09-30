/**
 * What a question's page promises its reader: a saved question opens drawn, with nothing to
 * press, and waits rather than guesses when a parameter has no value; it is read first and
 * turned to the workbench by the address (`?edit=1`), which a viewer never reaches; and its
 * panes are the address (`?view=`), so a link opens on the rows or the definition.
 *
 * No mocks: the real route, store, router, tRPC client and react-query over an in-memory
 * server that answers the procedures named here and refuses every other
 * (`test/mountRoute.tsx`). What the page asked for is read off that server's ledger.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { Question } from "@/routes/Question.tsx";
import { useUiStore } from "@/store.ts";
import { type Answer, mountRoute } from "@/test/mountRoute.tsx";

const TENANT = "CASE-0042";
const ID = "00000000-0000-4000-8000-000000000001";
const PATH = `/tenants/${TENANT}/reports/questions/${ID}`;
const WHEN = "2026-09-30T03:12:53.210Z";

/** Synthetic: two months of one invented model table, the second month's figure missing. */
const RESULT = {
  columns: [
    { name: "month", type: "text" },
    { name: "revenue", type: "numeric" },
  ],
  rows: [
    ["2026-08", "128600.50"],
    ["2026-09", null],
  ],
  truncated: false,
};

const VISUAL = {
  kind: "visual",
  table: "mart_revenue",
  fields: [{ column: "month" }, { column: "revenue" }],
  filters: [],
  groupBy: [],
  orderBy: [],
  limit: 1000,
};

function saved(over: Record<string, unknown> = {}): unknown {
  return {
    id: ID,
    name: "Doanh thu theo tháng",
    definition: VISUAL,
    chart: { type: "table", y: [], options: {} },
    updatedAt: WHEN,
    updatedBy: "u1",
    ...over,
  };
}

function served(role: string, question: unknown): Record<string, Answer> {
  return {
    "tenants.get": () => ({ tenantId: TENANT, displayName: "Acme", role }),
    "bi.schema": () => ({
      tables: [
        {
          name: "mart_revenue",
          columns: [
            { name: "month", type: "text" },
            { name: "revenue", type: "numeric" },
          ],
        },
      ],
    }),
    "bi.questions.get": () => question,
    "bi.questions.answer": () => RESULT,
    "bi.compile": () => ({ sql: 'SELECT "month", "revenue"\nFROM "mart_revenue"' }),
  };
}

function mount(
  url: string,
  role: string,
  question: unknown = saved(),
): ReturnType<typeof mountRoute> {
  return mountRoute({
    pattern: "/tenants/:tenantId/reports/questions/:id",
    url,
    element: <Question tenantId={TENANT} />,
    answers: served(role, question),
  });
}

afterEach(() => {
  cleanup();
  // The draft is the store's, and the store outlives a test.
  useUiStore.setState({ questionDraft: null });
});

describe("a saved question opens answered", () => {
  it("draws a viewer's answer without a press, and keeps the workbench from them even at ?edit=1", async () => {
    const { received } = mount(`${PATH}?edit=1`, "viewer");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("2026-08")).toBeDefined();
    // A missing figure is an em dash, never 0.
    expect(within(table).getByText("—")).toBeDefined();

    expect(screen.queryByLabelText("Tên câu hỏi")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sửa câu hỏi" })).toBeNull();
    // Read by id; a viewer's page never sends a definition.
    expect(received.map((request) => request.path)).not.toContain("bi.answer");
  });

  it("waits for a parameter's value rather than running without one, then answers on it", async () => {
    const question = saved({
      definition: { kind: "sql", sql: "select * from mart_revenue where region = {{region}}" },
    });
    const { received } = mount(PATH, "viewer", question);
    expect(
      await screen.findByText("Hãy nhập giá trị cho mọi tham số trước khi chạy."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Chạy" }).hasAttribute("disabled")).toBe(true);
    expect(received.map((request) => request.path)).not.toContain("bi.questions.answer");

    fireEvent.change(screen.getByLabelText("region"), { target: { value: "north" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    await screen.findByRole("table");
    const asked = received.find((request) => request.path === "bi.questions.answer");
    expect(asked?.input).toEqual({ tenantId: TENANT, id: ID, params: { region: "north" } });
  });
});

describe("read first, edit by the address", () => {
  it("shows an author the reading page, and Edit question and Done turn ?edit=1 on and off", async () => {
    const { router } = mount(PATH, "member");
    await screen.findByRole("table");
    expect(screen.queryByLabelText("Tên câu hỏi")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sửa câu hỏi" }));
    await waitFor(() => {
      expect(router.state.location.search).toBe("?edit=1");
    });
    expect(screen.getByLabelText("Tên câu hỏi")).toBeDefined();
    expect(screen.getByRole("region", { name: "Dựng câu hỏi" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Xong sửa" }));
    await waitFor(() => {
      expect(router.state.location.search).toBe("");
    });
    expect(screen.queryByLabelText("Tên câu hỏi")).toBeNull();
  });

  it("opens an author straight into the workbench from a pasted ?edit=1", async () => {
    mount(`${PATH}?edit=1`, "member");
    expect(await screen.findByLabelText("Tên câu hỏi")).toBeDefined();
    expect(screen.getByRole("button", { name: "Bỏ thay đổi" })).toBeDefined();
  });
});

describe("the panes are the address", () => {
  it("opens on the rows from ?view=data, and turns to the definition, compiled, for a viewer", async () => {
    const { router } = mount(
      `${PATH}?view=data`,
      "viewer",
      saved({ chart: { type: "bar", y: [], options: {} } }),
    );
    const panes = await screen.findByRole("navigation", { name: "Xem câu hỏi" });
    expect(within(panes).getByRole("link", { name: "Số liệu" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(await screen.findByRole("table")).toBeDefined();
    // The drawing is the default, and is written as no key at all.
    expect(within(panes).getByRole("link", { name: "Biểu đồ" }).getAttribute("href")).toBe(PATH);

    fireEvent.click(within(panes).getByRole("link", { name: "Định nghĩa" }));
    await waitFor(() => {
      expect(router.state.location.search).toBe("?view=definition");
    });
    expect(screen.getByText(/FROM "mart_revenue"/u)).toBeDefined();
    expect(screen.getByRole("link", { name: "mart_revenue" }).getAttribute("href")).toBe(
      `/tenants/${TENANT}/models/mart_revenue`,
    );
  });
});
