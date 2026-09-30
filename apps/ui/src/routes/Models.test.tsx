/**
 * What the Models division promises a reader walking it (#346): the build counts add up and
 * narrow the list through the address, and the lineage view highlights a model's declared
 * upstream chain in words, marks what it cannot read, and keeps a deleted ref.
 *
 * No mocks: the real route, store, router, tRPC client and react-query, over a fetch that
 * answers the division's three queries and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { Models } from "@/routes/Models.tsx";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";
const WHEN = "2026-09-30T03:12:53.210Z";

function built(name: string, status: string | null): unknown {
  return {
    name,
    updatedAt: WHEN,
    updatedBy: "u1",
    lastBuild: status === null ? null : { runId: "r1", status, endedAt: WHEN, columns: [] },
  };
}

const MODELS = [
  built("mart_pipeline", "success"),
  built("stg_deals", "success"),
  built("stg_files", "error"),
  built("stg_notes", null),
  built("stg_legacy", null),
  built("stg_skipped", "skipped"),
];

const model = (name: string, undeclared: unknown[] = []): unknown => ({
  kind: "model",
  id: `model:${name}`,
  name,
  undeclared,
});

/** Synthetic: the design contract's example, with a deleted ref added. */
const LINEAGE = {
  nodes: [
    { kind: "raw", id: "raw:raw.documents", name: "raw.documents" },
    { kind: "raw", id: "raw:raw.records", name: "raw.records" },
    model("mart_pipeline"),
    model("stg_deals"),
    model("stg_files"),
    model("stg_legacy", [{ code: "dynamic-reference", subject: "ref", via: null }]),
    model("stg_notes"),
    { kind: "missing", id: "missing:stg_gone", name: "stg_gone" },
  ],
  edges: [
    { from: "model:stg_deals", to: "model:mart_pipeline", via: null },
    { from: "model:stg_files", to: "model:mart_pipeline", via: null },
    { from: "raw:raw.records", to: "model:stg_deals", via: "gmail_letters" },
    { from: "raw:raw.documents", to: "model:stg_files", via: null },
    { from: "raw:raw.records", to: "model:stg_notes", via: null },
    { from: "missing:stg_gone", to: "model:stg_notes", via: null },
  ],
};

afterEach(cleanup);

function answer(data: unknown): Response {
  return Response.json({ result: { data } });
}

/** Mounts the division at `url` as a viewer; returns the router, to press Back with. */
function mount(url: string): ReturnType<typeof createMemoryRouter> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          if (path.endsWith("/tenants.get")) {
            return Promise.resolve(
              answer({ tenantId: TENANT, displayName: "Acme", role: "viewer" }),
            );
          }
          if (path.endsWith("/models.list")) {
            return Promise.resolve(answer(MODELS));
          }
          if (path.endsWith("/models.lineage")) {
            return Promise.resolve(answer(LINEAGE));
          }
          return Promise.resolve(Response.json({ error: { message: path } }, { status: 500 }));
        },
      }),
    ],
  });
  const router = createMemoryRouter(
    [{ path: "/tenants/:tenantId/models", element: <Models tenantId={TENANT} /> }],
    { initialEntries: [url] },
  );
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return router;
}

function listedNames(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

describe("the build counts", () => {
  it("add up to the models listed, and pressing one narrows the list; Back widens it", async () => {
    const router = mount(`/tenants/${TENANT}/models`);
    const tally = await screen.findByRole("navigation", {
      name: "Lọc danh sách theo lần dựng gần nhất",
    });
    const counts = within(tally)
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    // Failed, never built, other, built, then all: each a figure over its state's word.
    expect(counts).toEqual([
      "1Dựng lỗi",
      "2Chưa dựng",
      "1Kết quả khác",
      "2Dựng thành công",
      "6Mọi mô hình",
    ]);

    fireEvent.click(within(tally).getByRole("link", { name: /Chưa dựng/u }));
    expect(router.state.location.search).toBe("?build=never");
    expect(listedNames()).toEqual(["stg_notes", "stg_legacy"]);

    await act(() => router.navigate(-1));
    expect(listedNames()).toHaveLength(MODELS.length);
  });

  it("opens narrowed from a pasted address, and ignores a state it does not know", async () => {
    mount(`/tenants/${TENANT}/models?build=failed`);
    expect(await screen.findByText(/1 \/ 6 mô hình/u)).toBeDefined();
    expect(listedNames()).toEqual(["stg_files"]);
    cleanup();

    mount(`/tenants/${TENANT}/models?build=bogus`);
    await screen.findByRole("table");
    expect(listedNames()).toHaveLength(MODELS.length);
  });
});

describe("the lineage view", () => {
  it("lists the selected model's whole upstream chain, in words, and not the rest", async () => {
    mount(`/tenants/${TENANT}/models?view=lineage&model=mart_pipeline`);
    const chain = await screen.findByRole("region", { name: /Thượng nguồn của mart_pipeline/u });
    const names = within(chain)
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".journal__what")?.textContent);
    // The selected model first, then its chain; stg_notes reads raw.records too, but is not on it.
    expect(names[0]).toBe("mart_pipeline");
    expect(names.slice(1).sort()).toEqual(["raw.documents", "raw.records", "stg_deals", "stg_files"]);
    expect(within(chain).getByText(/raw\.records \(qua macro gmail_letters\)/u)).toBeDefined();
    // The drawing says it in words too: a node on the chain, and one off it.
    const drawing = screen.getByRole("figure");
    expect(within(drawing).getByRole("link", { name: /stg_deals.*Thượng nguồn/u })).toBeDefined();
    expect(within(drawing).getByRole("link", { name: /^stg_notes$/u })).toBeDefined();
  });

  it("marks an undeclared upstream and a deleted ref in words, with every model listed", async () => {
    mount(`/tenants/${TENANT}/models?view=lineage`);
    const all = await screen.findByRole("region", { name: "Mỗi mô hình và những gì nó đọc" });
    expect(within(all).getByText(/không phải chuỗi cố định/u)).toBeDefined();
    expect(within(all).getByText(/Đọc: raw\.records, stg_gone/u)).toBeDefined();
    const drawing = screen.getByRole("figure");
    expect(within(drawing).getByText("stg_gone").nextSibling?.textContent).toBe(
      "Phụ thuộc bị thiếu",
    );
    expect(
      within(drawing).getByRole("link", { name: /stg_legacy.*Thượng nguồn chưa khai báo/u }),
    ).toBeDefined();
  });
});
