/**
 * What one open model promises its author: an unsaved draft says why Build waits and can be
 * discarded back to what the server holds -- in the store AND in the editor on screen, which is
 * uncontrolled and would otherwise keep showing the discarded text -- and the dependencies band
 * lists only what the saved SQL declares, marking a deleted ref as missing and an unreadable
 * upstream as undeclared rather than as "reads nothing".
 *
 * No mocks: the real route, store, router, tRPC client, react-query and CodeMirror, over a fetch
 * that answers the leaf's queries and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import type { ModelDetail } from "@/api/types.ts";
// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { draftFrom } from "@/lib/modelDraft.ts";
import { ModelEditor } from "@/routes/ModelEditor.tsx";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";
const WHEN = "2026-09-30T03:12:53.210Z";

function detail(name: string): ModelDetail {
  return {
    name,
    updatedAt: WHEN,
    updatedBy: "u1",
    lastBuild: { runId: "run-7", status: "success", endedAt: WHEN, columns: ["deal_id"] },
    sql: `select 1 as deal_id -- ${name}`,
    tests: { columns: {} },
  };
}

/** Synthetic: one model reads the raw lake and a deleted model; one cannot be read at all. */
const LINEAGE = {
  nodes: [
    { kind: "raw", id: "raw:raw.records", name: "raw.records" },
    { kind: "model", id: "model:stg_notes", name: "stg_notes", undeclared: [] },
    { kind: "model", id: "model:mart_notes", name: "mart_notes", undeclared: [] },
    {
      kind: "model",
      id: "model:stg_legacy",
      name: "stg_legacy",
      undeclared: [{ code: "dynamic-reference", subject: "ref", via: null }],
    },
    { kind: "model", id: "model:stg_blank", name: "stg_blank", undeclared: [] },
    { kind: "missing", id: "missing:stg_gone", name: "stg_gone" },
  ],
  edges: [
    { from: "raw:raw.records", to: "model:stg_notes", via: "gmail_letters" },
    { from: "missing:stg_gone", to: "model:stg_notes", via: null },
    { from: "model:stg_notes", to: "model:mart_notes", via: null },
  ],
};

afterEach(() => {
  cleanup();
  useUiStore.setState({ modelDraft: null });
});

function answer(data: unknown): Response {
  return Response.json({ result: { data } });
}

function mount(name: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          if (path.endsWith("/tenants.get")) {
            return Promise.resolve(
              answer({ tenantId: TENANT, displayName: "Acme", role: "admin" }),
            );
          }
          if (path.endsWith("/models.get")) {
            return Promise.resolve(answer(detail(name)));
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
    [{ path: "/tenants/:tenantId/models/:name", element: <ModelEditor tenantId={TENANT} /> }],
    { initialEntries: [`/tenants/${TENANT}/models/${name}`] },
  );
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

const HINT = /Hãy lưu hoặc bỏ thay đổi trước/u;

describe("an unsaved draft", () => {
  it("says why Build waits, and Discard puts back what the server holds, on screen too", async () => {
    // Edits from an earlier visit, held in the store as the division keeps them.
    const stored = draftFrom(TENANT, detail("stg_notes"));
    useUiStore.setState({ modelDraft: { ...stored, sql: "select 2 as edited" } });
    mount("stg_notes");

    const editor = await screen.findByRole("textbox", { name: "SQL của mô hình" });
    expect(editor.textContent).toBe("select 2 as edited");
    expect(screen.getByText(HINT)).toBeDefined();
    expect(screen.getByRole("button", { name: "Dựng" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Bỏ thay đổi" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "SQL của mô hình" }).textContent).toBe(stored.sql);
    });
    expect(useUiStore.getState().modelDraft?.sql).toBe(stored.sql);
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByText("Đã lưu.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Dựng" }).hasAttribute("disabled")).toBe(false);
  });
});

/** The dependencies band's list under one of its two heads. */
function namesUnder(head: string): string[] {
  const section = screen.getByText(head, { selector: "h2" }).closest("section") as HTMLElement;
  return within(section)
    .queryAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("the dependencies band", () => {
  it("lists what the model declares it reads and what reads it, a deleted ref kept as missing", async () => {
    mount("stg_notes");
    await screen.findByText("Phụ thuộc");
    await screen.findByRole("link", { name: "raw.records" });

    expect(namesUnder("Đọc").sort((a, b) => a.localeCompare(b))).toEqual([
      "raw.recordsBảng hồ thôqua macro gmail_letters",
      "stg_goneRef tới mô hình không còn",
    ]);
    expect(screen.getByRole("link", { name: "raw.records" }).getAttribute("href")).toBe(
      `/tenants/${TENANT}/lake`,
    );
    expect(namesUnder("Được đọc bởi")).toEqual(["mart_notes"]);
    expect(screen.getByRole("link", { name: "mart_notes" }).getAttribute("href")).toBe(
      `/tenants/${TENANT}/models/mart_notes`,
    );
  });

  it("says why an upstream cannot be read, and never that the model reads nothing", async () => {
    mount("stg_legacy");
    await screen.findByText("Phụ thuộc");
    await screen.findByText("Thượng nguồn chưa khai báo");

    expect(screen.queryByText("Không khai báo đọc gì.")).toBeNull();
    expect(screen.getByText("Không mô hình nào khai báo đọc nó.")).toBeDefined();
  });

  it("says a model reads nothing only when its declarations are all readable", async () => {
    mount("stg_blank");
    expect(await screen.findByText("Không khai báo đọc gì.")).toBeDefined();
    expect(screen.queryByText("Thượng nguồn chưa khai báo")).toBeNull();
  });
});
