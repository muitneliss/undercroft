/**
 * What the catalogue page promises about the one press on it that costs (ADR 0085): publishing
 * sends every readable document to the classifier again, so the first press sends nothing and
 * the second names how many documents it will send.
 *
 * No mocks: the real route, store, tRPC client and react-query, over a fetch that answers the
 * page's two queries and the publish, and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, beforeEach, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { DocumentKinds } from "@/routes/DocumentKinds.tsx";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";

const CATALOGUE = {
  kinds: [
    { kind: "invoice", description: "A bill.", origin: "initialised", sampleShare: "0.3867" },
    { kind: "other", description: "None of the above.", origin: "initialised", sampleShare: null },
  ].map((row) => ({ ...row, updatedBy: "run:r1", updatedAt: "2026-09-30T03:12:53.210Z" })),
  available: [],
  published: null,
  unpublishedChanges: true,
  readableDocuments: 1200,
};

beforeEach(() => {
  useUiStore.setState({ kindsPublishArmed: null, kindEditing: null });
});

afterEach(cleanup);

function answer(data: unknown): Response {
  return Response.json({ result: { data } });
}

/** Mounts the page as an admin; returns how many publishes the server has been sent. */
function mount(): { publishes: () => number } {
  let publishes = 0;
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
          if (path.endsWith("/documentKinds.list")) {
            return Promise.resolve(answer(CATALOGUE));
          }
          if (path.endsWith("/documentKinds.publish")) {
            publishes += 1;
            return Promise.resolve(answer({ version: 1, changed: true }));
          }
          return Promise.resolve(Response.json({ error: { message: path } }, { status: 500 }));
        },
      }),
    ],
  });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DocumentKinds tenantId={TENANT} />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { publishes: () => publishes };
}

it("publishing asks twice, and only the second press, which names the count, sends it", async () => {
  const server = mount();

  fireEvent.click(await screen.findByRole("button", { name: "Publish danh mục" }));
  const confirm = screen.getByRole("button", { name: "Xác nhận: phân loại lại 1.200 tài liệu" });
  const sentAfterFirstPress = server.publishes();
  fireEvent.click(confirm);

  expect(await screen.findByText(/Đã publish phiên bản 1/u)).toBeDefined();
  expect(sentAfterFirstPress).toBe(0);
  expect(server.publishes()).toBe(1);
});
