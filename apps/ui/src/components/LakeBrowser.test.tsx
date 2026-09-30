/**
 * What the lake browser promises about a payload it hands away: the original string, exactly as
 * the server sent it. Parsed and re-printed it would still look like the record -- and an id past
 * 2^53 would have become a different number on the way, which is the one thing a copy of raw
 * evidence may not do.
 *
 * No mocks: the real component, tRPC client and react-query, over a fetch that answers the one
 * query the browser makes and REFUSES every other path, and happy-dom's own clipboard, read back
 * after the press.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LakeBrowser } from "@/components/LakeBrowser.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";

/** Spaced as no serialiser would print it, and holding an integer a float cannot. */
const PAYLOAD = '{"id": 12345678901234567890,\n   "name":"Acme Trading"}';

afterEach(cleanup);

function answer(data: unknown): Response {
  return Response.json({ result: { data } });
}

function refuse(path: string): Response {
  return Response.json(
    {
      error: {
        message: `unmodelled request: ${path}`,
        code: -32_603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      },
    },
    { status: 500 },
  );
}

function mount(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = {
    items: [
      {
        sourceRecordId: "deal-1",
        payload: PAYLOAD,
        observedAt: "2026-09-17T11:00:00Z",
        loadedAt: "2026-09-17T11:01:00Z",
        runId: "run-1",
        deletedAt: null,
      },
    ],
    nextCursor: null,
    ofRun: null,
  };
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          return Promise.resolve(path.endsWith("/lake.records") ? answer(page) : refuse(path));
        },
      }),
    ],
  });

  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/tenants/${TENANT}/lake?source=hubspot&entity=deals`]}>
          <LakeBrowser tenantId={TENANT} />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

describe("a payload's copy", () => {
  it("is the string the server sent, unparsed, and says it was copied", async () => {
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Sao chép chuỗi gốc" }));

    expect(await screen.findByText("Đã sao chép nguyên chuỗi.")).toBeDefined();
    expect(await navigator.clipboard.readText()).toBe(PAYLOAD);
  });
});
