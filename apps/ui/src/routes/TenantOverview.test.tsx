/**
 * What the schedule promises a tenant with two Gmail mailboxes (ADR 0043): both are listed by
 * address with their own health, and the one card below is about the mailbox the reader chose.
 *
 * The second promise is the one worth a page-level suite. Every action on the card sends the
 * card's own source, so a card that did not follow the choice would have Run now and
 * Disconnect act on the mailbox the reader was NOT looking at -- the kind of wrong that
 * renders perfectly.
 *
 * No mocks: the real route, the real store, the real tRPC client and react-query, over a fetch
 * that answers the two queries this page makes and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { TenantOverview } from "@/routes/TenantOverview.tsx";
import { useUiStore } from "@/store.ts";
import { connection } from "@/test/fixtures.ts";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";

/** The schedule as `connections.list` answers it: Gmail twice, in the server's order. */
const SCHEDULE = [
  connection("hubspot"),
  connection("xero"),
  connection("gmail", { status: "connected", externalAccountLabel: "ops@acme.test" }),
  connection("gmail.3fa9c1d2e0ab", {
    status: "needs_reconnect",
    externalAccountLabel: "sales@acme.test",
  }),
  connection("drive"),
];

beforeEach(() => {
  useUiStore.setState({ selectedAccount: {} });
});

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

/**
 * The page as `role` sees it. A member gets the schedule and no plate that would act on it; an
 * admin's Run now is answered with `trigger`, which the test settles when it chooses.
 */
function mount(role: "member" | "admin" = "member", trigger?: Promise<Response>): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          if (path.endsWith("/connections.list")) {
            return Promise.resolve(answer(SCHEDULE));
          }
          if (path.endsWith("/tenants.get")) {
            return Promise.resolve(answer({ tenantId: TENANT, displayName: "Acme", role }));
          }
          if (path.endsWith("/runs.trigger") && trigger !== undefined) {
            return trigger;
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
          <TenantOverview tenantId={TENANT} />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

describe("a tenant with two Gmail mailboxes", () => {
  it("lists each mailbox by its address, carrying that mailbox's own status", async () => {
    mount();

    expect(await screen.findByRole("radio", { name: /ops@acme\.test.*Đã cấp/u })).toBeDefined();
    expect(screen.getByRole("radio", { name: /sales@acme\.test.*Cần kết nối lại/u })).toBeDefined();
  });

  it("choosing the second mailbox turns the card to that mailbox", async () => {
    mount();
    const second = await screen.findByRole("radio", { name: /sales@acme\.test/u });

    fireEvent.click(second);

    const card = screen.getByRole("article", { name: "Gmail" });
    expect(within(card).getByText("sales@acme.test")).toBeDefined();
    expect(within(card).queryByText("ops@acme.test")).toBeNull();
  });
});

describe("an admin starting a run", () => {
  it("the card it was started from says so until the server answers, and the rest wait", async () => {
    let settle: ((response: Response) => void) | undefined;
    const trigger = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    mount("admin", trigger);
    const gmail = await screen.findByRole("article", { name: "Gmail" });

    fireEvent.click(within(gmail).getByRole("button", { name: "Chạy ngay" }));

    const starting = await within(gmail).findByRole("button", { name: "Đang bắt đầu…" });
    expect(starting.hasAttribute("disabled")).toBe(true);
    // Every plate waits, but only the pressed card claims the action: Drive's still reads as
    // what it would do, not as something under way.
    const drive = screen.getByRole("article", { name: "Google Drive" });
    const connect = within(drive).getByRole("button", { name: "Kết nối Google Drive" });
    expect(connect.hasAttribute("disabled")).toBe(true);

    settle?.(answer({ runId: "run-9" }));
    expect(await within(gmail).findByRole("button", { name: "Chạy ngay" })).toBeDefined();
  });
});
