import "@/i18n/index.ts";
import { afterEach, describe, expect, test as it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { readDetails, readSample } from "@/prototype/details.ts";
import { createCatalog } from "@/prototype/fixtures.ts";
import { useUiStore } from "@/store.ts";
import { ModelsWorkspace } from "./ModelsWorkspace.tsx";
import type { ProfileSource } from "./profileSource.ts";
import { initialWorkspace } from "./types.ts";

const source: ProfileSource = {
  details: async (id) => readDetails(id),
  sample: async (id) => readSample(id),
};
afterEach(cleanup);
function mount(url: string): ReturnType<typeof createMemoryRouter> {
  useUiStore.setState({ modelsWorkspace: { ...initialWorkspace } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [{ path: "*", element: <ModelsWorkspace catalog={createCatalog()} source={source} /> }],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("Models prototype reader journeys", () => {
  it("separates build success from quality warnings and unknown freshness", async () => {
    mount("/?view=detail&model=int_demo_011&tab=operations");
    await waitFor(() => expect(screen.getByText("3 đạt · 1 cảnh báo · 0 lỗi")).toBeDefined());
    expect(screen.getByText("Chưa đo")).toBeDefined();
    const warning = screen.getByRole("row", { name: /not_null_customer_id/u });
    expect(within(warning).getByText("38")).toBeDefined();
    expect(within(warning).getByText("Cảnh báo")).toBeDefined();
    const failedRun = screen.getByRole("row", { name: /demo-run-102/u });
    expect(within(failedRun).getByText("Chạy thất bại")).toBeDefined();
    fireEvent.click(within(failedRun).getByText("Xem lỗi / chi tiết"));
    expect(failedRun.querySelector("details")?.open).toBe(true);
    expect(within(failedRun).getByText(/column i.customer_id does not exist/u)).toBeDefined();
  });

  it("does not invent evidence for models outside the authored examples", async () => {
    const router = mount("/?view=detail&model=int_demo_012&tab=data");
    await waitFor(() =>
      expect(screen.getByText(/Model này chưa có metadata kỹ thuật/u)).toBeDefined(),
    );
    expect(screen.queryByText("12480")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xem hồ sơ minh họa đầy đủ →" }));
    await waitFor(() => expect(screen.getByText("12480")).toBeDefined());
    expect(new URLSearchParams(router.state.location.search).get("model")).toBe(
      "int_invoice_balance",
    );
    fireEvent.click(screen.getByRole("button", { name: "SQL & cấu hình" }));
    await waitFor(() =>
      expect(screen.getByText("demo_warehouse.analytics.int_invoice_balance")).toBeDefined(),
    );
    expect(screen.getByText(/SQL sau biên dịch và execution plan: chưa thu thập/u)).toBeDefined();
  });

  it("opening a neighbour profile preserves the original lineage root and scope", () => {
    const router = mount("/?view=lineage&model=int_invoice_balance&mode=table&dir=both&depth=2");
    fireEvent.click(screen.getByRole("button", { name: "Hóa đơn stg_invoices" }));
    fireEvent.click(screen.getByRole("button", { name: "Mở hồ sơ model →" }));
    const detail = new URLSearchParams(router.state.location.search);
    expect(detail.get("model")).toBe("int_invoice_balance");
    expect(detail.get("profile")).toBe("stg_invoices");
    fireEvent.click(screen.getByRole("button", { name: "← Quay lại dòng dữ liệu" }));
    const restored = new URLSearchParams(router.state.location.search);
    expect(restored.get("view")).toBe("lineage");
    expect(restored.get("depth")).toBe("2");
    expect(restored.get("model")).toBe("int_invoice_balance");
  });

  it("retains all selected IDs across chooser pages, cancellation and URL reload", () => {
    const router = mount("/?view=lineage&model=stg_invoices&mode=table");
    fireEvent.click(screen.getByRole("button", { name: "Hiện thêm model" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Chọn tất cả 102 kết quả tìm kiếm" }));
    fireEvent.click(dialog.getByRole("button", { name: "Sau" }));
    expect(useUiStore.getState().modelsWorkspace.selected).toHaveLength(102);
    fireEvent.click(dialog.getByRole("button", { name: "Xem lựa chọn bằng bảng" }));
    const saved = router.state.location.search;
    expect(new URLSearchParams(saved).get("shown")?.split(",")).toHaveLength(103);
    fireEvent.click(screen.getByRole("button", { name: "Hiện thêm model" }));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn tất cả" }));
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(router.state.location.search).toBe(saved);
    cleanup();
    mount(`/${saved}`);
    expect(screen.getByRole("combobox", { name: "Trang 1 / 5" })).toBeDefined();
    expect(screen.getAllByRole("row")).toHaveLength(26);
    router.dispose();
  });

  it("preserves the list query/page through profile navigation and browser Back", async () => {
    const router = mount("/?layer=input&page=2");
    const before = router.state.location.search;
    const names = screen.getAllByRole("link").filter((link) => link.className === "mw-name");
    const [first] = names;
    if (!first) {
      throw new Error("Expected a model on page 2");
    }
    fireEvent.click(first);
    expect(screen.getByRole("navigation", { name: "Hiểu dữ liệu" })).toBeDefined();
    await Promise.resolve(
      act(async (): Promise<void> => {
        await router.navigate(-1);
      }),
    );
    expect(router.state.location.search).toBe(before);
    expect(screen.getAllByRole("combobox", { name: "Trang 2 / 2" })).toHaveLength(2);
  });

  it("loads a sample only on request and renders monetary values with currency", async () => {
    mount("/?view=detail&model=int_invoice_balance&tab=data");
    await waitFor(() => expect(screen.getByText("invoice_id")).toBeDefined());
    expect(screen.queryByText("USD 400.00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xem dữ liệu mẫu" }));
    await waitFor(() => expect(screen.getByText(/400/u)).toBeDefined());
    expect(screen.getByText(/400/u).textContent).toContain("USD");
  });
});
