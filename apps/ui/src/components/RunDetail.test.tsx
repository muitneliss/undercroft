/**
 * What a run's leaf promises about the path from a run to what it wrote (ADR 0091).
 *
 * Two promises, each a way the leaf could quietly be wrong:
 * - an admin's created and changed counts are doors onto the rows that run wrote, and a member's
 *   or viewer's are plain figures -- a link that answered FORBIDDEN would be a promise the leaf
 *   breaks;
 * - the scope printed is the one the run recorded, and a run that recorded none prints MISSING,
 *   never the connection's scope today.
 *
 * No mocks: the real component, store, tRPC client and react-query, over a fetch that answers
 * the three queries the leaf makes and REFUSES every other path -- so a leaf that went looking
 * for today's scope in `connections.list` would fail here rather than borrow it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { RunDetail as RunDetailView } from "@/api/types.ts";
import { RunDetail } from "@/components/RunDetail.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { MISSING } from "@/lib/money.ts";
import { runDetail } from "@/test/fixtures.ts";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";

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

/** A Gmail ingest that created three messages and changed two. */
function gmailRun(over: Partial<RunDetailView> = {}): RunDetailView {
  return runDetail({
    source: "gmail",
    entities: ["messages"],
    entityCounts: [
      { entity: "messages", landed: 5, created: 3, changed: 2, unchanged: 0, refused: 0 },
    ],
    ...over,
  });
}

function mount(role: "viewer" | "member" | "admin", detail: RunDetailView): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tenant = { tenantId: TENANT, displayName: "Acme", role };
  // Seeded, as the book's own head has already read it by the time a leaf opens -- and so the
  // role is known at the first render, and a figure without a link cannot pass merely because
  // the role had not arrived yet.
  queryClient.setQueryData(getQueryKey(trpc.tenants.get, { tenantId: TENANT }, "query"), tenant);
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          if (path.endsWith("/runs.get")) {
            return Promise.resolve(answer(detail));
          }
          if (path.endsWith("/runs.events")) {
            return Promise.resolve(answer([]));
          }
          if (path.endsWith("/tenants.get")) {
            return Promise.resolve(answer(tenant));
          }
          return Promise.resolve(refuse(path));
        },
      }),
    ],
  });

  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RunDetail tenantId={TENANT} runId={detail.id} />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

describe("a run's counts", () => {
  it("open, for an admin, the rows that run wrote in the raw lake", async () => {
    mount("admin", gmailRun());

    const created = await screen.findByRole("link", { name: "3" });
    const changed = screen.getByRole("link", { name: "2" });

    expect(created.getAttribute("href")).toBe(
      `/tenants/${TENANT}/lake?source=gmail&entity=messages&run=run-1`,
    );
    expect(changed.getAttribute("href")).toBe(created.getAttribute("href"));
  });

  for (const role of ["member", "viewer"] as const) {
    it(`are plain figures for a ${role}`, async () => {
      mount(role, gmailRun());

      expect(await screen.findByText("3")).toBeDefined();
      expect(screen.queryByRole("link", { name: "3" })).toBeNull();
      expect(screen.queryByRole("link", { name: "2" })).toBeNull();
    });
  }
});

describe("the scope a run read with", () => {
  it("is the scope the run recorded, in the card's own words", async () => {
    mount("member", gmailRun({ scope: { labels: ["Invoices"], fileTypes: ["application/pdf"] } }));

    expect(await screen.findByText("Phạm vi lúc chạy")).toBeDefined();
    expect(screen.getByText(/Invoices/u)).toBeDefined();
  });

  it("is MISSING for a run that recorded none", async () => {
    mount("member", gmailRun({ scope: null }));

    const label = await screen.findByText("Phạm vi lúc chạy");
    expect(label.nextElementSibling?.textContent).toBe(MISSING);
  });
});
