/**
 * When the scope screen will record a choice, for a mailbox.
 *
 * Gmail's empty choice is a recorded decision meaning the WHOLE mailbox. So Save on a screen
 * whose list did not load is not an inert button: one press recorded "read everything" from a
 * page that showed nothing but an error (issue 213). The guard and its quiet side are both
 * here, because a Save that was simply always disabled would pass the first test alone.
 *
 * No mocks: the real route, the real store, the real tRPC client and react-query, over a fetch
 * that answers the two queries this screen makes and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { ScopePicker } from "@/routes/ScopePicker.tsx";
import { useUiStore } from "@/store.ts";
import { connection } from "@/test/fixtures.ts";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";
const MAILBOX = "gmail.3fa9c1d2e0ab";
const SCHEDULE = [
  connection(MAILBOX, { status: "connected", externalAccountLabel: "sales@acme.test" }),
];
/** What the control plane answers a browse whose credential could not be refreshed. */
const REFUSED = "Quyền truy cập của kết nối đã hết hạn hoặc đã bị thu hồi.";

beforeEach(() => {
  useUiStore.setState({ scopeDraft: null });
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

/** The screen for the second mailbox, its list answered by `browse`. */
function mount(browse: () => Response): void {
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
          if (path.endsWith("/connections.browseScope")) {
            return Promise.resolve(browse());
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
          <ScopePicker tenantId={TENANT} source={MAILBOX} kind="gmail" />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

async function save(): Promise<HTMLButtonElement> {
  return await screen.findByRole<HTMLButtonElement>("button", { name: "Lưu lựa chọn" });
}

describe("saving a mailbox's scope", () => {
  it("a list that did not load cannot be saved as the whole mailbox", async () => {
    mount(() =>
      Response.json(
        {
          error: {
            message: REFUSED,
            code: -32_012,
            data: { code: "PRECONDITION_FAILED", httpStatus: 412 },
          },
        },
        { status: 412 },
      ),
    );

    expect(await screen.findByText(REFUSED)).toBeDefined();
    expect((await save()).disabled).toBe(true);
  });

  it("a list that loaded can be saved with nothing ticked, which is the whole mailbox", async () => {
    mount(() =>
      answer({ items: [{ id: "Label_8", name: "Invoices", kind: "user" }], partial: [] }),
    );

    expect(await screen.findByText("Invoices")).toBeDefined();
    expect((await save()).disabled).toBe(false);
  });
});
