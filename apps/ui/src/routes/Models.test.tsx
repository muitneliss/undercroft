/**
 * What the Models division promises a reader walking it (#346): the build counts add up --
 * and say so in figures -- and narrow the list through the address, a search and an order ride
 * there beside them, each row names the run that built it and never prints a column count it
 * does not know, and the lineage view traces a node's declared upstream
 * chain and paths and its downstream in words, marks what it cannot read, keeps a deleted ref,
 * and states the selected model's last build and columns beside the board (ADR 0097).
 *
 * No mocks: the real route, store, router, tRPC client and react-query, over a fetch that
 * answers the division's four queries and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { MISSING } from "@/lib/money.ts";
import { Models } from "@/routes/Models.tsx";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";
const WHEN = "2026-09-30T03:12:53.210Z";

function built(name: string, status: string | null, columns: string[] = []): unknown {
  return {
    name,
    updatedAt: WHEN,
    updatedBy: "u1",
    lastBuild: status === null ? null : { runId: "run-7", status, endedAt: WHEN, columns },
  };
}

const MODELS = [
  built("mart_pipeline", "success", ["deal_id", "stage", "amount"]),
  built("stg_deals", "success"),
  built("stg_files", "error"),
  built("stg_notes", null),
  built("stg_legacy", null),
  built("stg_skipped", "skipped"),
];

function model(name: string, undeclared: unknown[] = []): unknown {
  return { kind: "model", id: `model:${name}`, name, undeclared };
}

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
          if (path.endsWith("/models.get")) {
            const detail = MODELS[0] as Record<string, unknown>;
            return Promise.resolve(
              answer({
                ...detail,
                sql: "select * from {{ ref('stg_deals') }}",
                tests: { columns: {} },
              }),
            );
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

/** The name on each row, in the order listed: a row's first link (its second is its run). */
function listedNames(): string[] {
  const [, ...rows] = within(screen.getByRole("table")).getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("link")[0]?.textContent ?? "");
}

/** One row's cells as text, found by the model's name. */
function rowOf(name: string): string[] {
  const row = within(screen.getByRole("table")).getByRole("link", { name }).closest("tr");
  return within(row as HTMLElement)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
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
    expect(screen.getByText("1 + 2 + 1 + 2 = 6 mô hình trong danh sách")).toBeDefined();

    fireEvent.click(within(tally).getByRole("link", { name: /Chưa dựng/u }));
    expect(router.state.location.search).toBe("?build=never");
    expect(listedNames()).toEqual(["stg_legacy", "stg_notes"]);

    // Inside `act`: the router's own update would otherwise land between two of React's.
    act(() => {
      void router.navigate(-1);
    });
    await waitFor(() => {
      expect(listedNames()).toHaveLength(MODELS.length);
    });
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

describe("the search and the order", () => {
  it("lists what needs a person first, and by name when asked, keeping the build state", async () => {
    const router = mount(`/tenants/${TENANT}/models`);
    await screen.findByRole("table");
    // Failed, never built, other, built -- then by name inside each.
    expect(listedNames()).toEqual([
      "stg_files",
      "stg_legacy",
      "stg_notes",
      "stg_skipped",
      "mart_pipeline",
      "stg_deals",
    ]);

    fireEvent.click(screen.getByRole("link", { name: /Dựng thành công/u }));
    fireEvent.change(screen.getByLabelText("Sắp xếp"), { target: { value: "name" } });
    expect(new URLSearchParams(router.state.location.search).get("build")).toBe("ok");
    expect(new URLSearchParams(router.state.location.search).get("sort")).toBe("name");
    expect(listedNames()).toEqual(["mart_pipeline", "stg_deals"]);
  });

  it("counts only what the search finds, so the counts still add up, and a count keeps it", async () => {
    const router = mount(`/tenants/${TENANT}/models?q=STG_N`);
    const tally = await screen.findByRole("navigation", {
      name: "Lọc danh sách theo lần dựng gần nhất",
    });
    expect(listedNames()).toEqual(["stg_notes"]);
    expect(screen.getByText("0 + 1 + 0 + 0 = 1 mô hình trong danh sách")).toBeDefined();
    expect(screen.getByText("1 / 6 mô hình")).toBeDefined();

    fireEvent.click(within(tally).getByRole("link", { name: /Chưa dựng/u }));
    const address = new URLSearchParams(router.state.location.search);
    expect([address.get("q"), address.get("build")]).toEqual(["STG_N", "never"]);

    fireEvent.click(screen.getByRole("button", { name: "Xoá lọc" }));
    expect(router.state.location.search).toBe("");
    expect(listedNames()).toHaveLength(MODELS.length);
  });
});

describe("a row's last build", () => {
  it("names the run that built it and the columns it made, and MISSING for what is not known", async () => {
    mount(`/tenants/${TENANT}/models`);
    await screen.findByRole("table");
    const [run] = within(screen.getByRole("table")).getAllByRole("link", { name: "run-7" });
    expect(run?.getAttribute("href")).toBe(`/tenants/${TENANT}/journal/run-7`);
    expect(rowOf("mart_pipeline").slice(1, 4)).toEqual(["Dựng thành công", "run-7", "3"]);
    // Built, but the server recorded no columns: not known, never "0".
    expect(rowOf("stg_deals")[3]).toBe(MISSING);
    // Never built: no run and no columns.
    expect(rowOf("stg_notes").slice(2, 4)).toEqual([MISSING, MISSING]);
  });
});

/**
 * The name of every card on the board, as the board states it to a screen reader. A card is
 * the board's one pressable button -- the zoom plates and "reset layout" are plain ones.
 */
function cards(): string[] {
  const board = within(screen.getByRole("figure"));
  return [
    ...board.queryAllByRole("button", { pressed: false }),
    ...board.queryAllByRole("button", { pressed: true }),
  ].map((card) => card.getAttribute("aria-label") ?? "");
}

describe("the lineage view", () => {
  it("traces the selected model's whole upstream chain and every path to it, and not the rest", async () => {
    mount(`/tenants/${TENANT}/models?view=lineage&model=mart_pipeline`);
    const trace = await screen.findByRole("region", { name: /Thượng nguồn của mart_pipeline/u });
    const [names, paths] = within(trace).getAllByRole("list");
    // stg_notes reads raw.records too, but is not on the chain.
    expect(
      within(names as HTMLElement)
        .getAllByRole("link")
        .map((link) => link.textContent)
        .sort(),
    ).toEqual(["raw.documents", "raw.records", "stg_deals", "stg_files"]);
    // Each path runs from the raw lake down to the model, naming the macro that declares a hop.
    expect(
      within(paths as HTMLElement)
        .getAllByRole("listitem")
        .map((path) => path.textContent)
        .sort(),
    ).toEqual([
      "raw.documentsstg_filesmart_pipeline",
      "raw.records(qua macro gmail_letters)stg_dealsmart_pipeline",
    ]);
    // The board says it in words too: a card on the chain, and one off it.
    await waitFor(() => {
      expect(cards()).toContain("stg_deals · Thượng nguồn · Dựng thành công");
    });
    expect(cards()).toContain("stg_notes · Chưa dựng");
  });

  it("marks an undeclared upstream and a deleted ref in words, with every model listed", async () => {
    mount(`/tenants/${TENANT}/models?view=lineage`);
    const all = await screen.findByRole("region", { name: "Mỗi mô hình và những gì nó đọc" });
    expect(within(all).getByText(/không phải chuỗi cố định/u)).toBeDefined();
    expect(within(all).getByText(/Đọc: raw\.records, stg_gone/u)).toBeDefined();
    expect(cards()).toContain("stg_gone · Phụ thuộc bị thiếu");
    expect(cards().some((card) => card.startsWith("stg_legacy · Thượng nguồn chưa khai báo"))).toBe(
      true,
    );
  });

  it("selects a raw lake table by its card, and names everything downstream of it", async () => {
    const router = mount(`/tenants/${TENANT}/models?view=lineage`);
    await screen.findByRole("region", { name: "Mỗi mô hình và những gì nó đọc" });
    fireEvent.click(within(screen.getByRole("figure")).getByTitle("raw.records"));
    expect(router.state.location.search).toBe("?view=lineage&model=raw.records");

    const trace = await screen.findByRole("region", { name: /Thượng nguồn của raw\.records/u });
    const downstream = within(trace).getAllByRole("list").at(-1) as HTMLElement;
    expect(
      within(downstream)
        .getAllByRole("link")
        .map((link) => link.textContent)
        .sort(),
    ).toEqual(["mart_pipeline", "stg_deals", "stg_notes"]);
  });

  it("states the selected model's last build, its columns and the run that built it", async () => {
    mount(`/tenants/${TENANT}/models?view=lineage&model=mart_pipeline`);
    const details = await screen.findByRole("complementary", { name: "mart_pipeline" });
    expect(await within(details).findByText("Dựng thành công")).toBeDefined();
    expect(
      within(details)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
        .filter((text) => ["deal_id", "stage", "amount"].includes(text ?? "")),
    ).toEqual(["deal_id", "stage", "amount"]);
    expect(within(details).getByRole("link", { name: "Mở lần chạy" }).getAttribute("href")).toBe(
      `/tenants/${TENANT}/journal/run-7`,
    );
  });

  it("narrows the board to what is related to the selection, and back", async () => {
    mount(`/tenants/${TENANT}/models?view=lineage&model=stg_files&scope=related`);
    await screen.findByRole("region", { name: /Thượng nguồn của stg_files/u });
    expect(
      cards()
        .map((card) => card.split(" · ")[0] ?? "")
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["mart_pipeline", "raw.documents", "stg_files"]);

    fireEvent.click(screen.getByRole("link", { name: "Hiện mọi nút" }));
    await waitFor(() => {
      expect(cards()).toHaveLength(LINEAGE.nodes.length);
    });
  });
});
