/**
 * What the People division promises an admin before the server has to refuse them (#348): the
 * customer's only admin is marked and offered neither a lower role nor removal, and
 * withdrawing an invitation takes a second press that names the address.
 *
 * No mocks: the real route, tRPC client and react-query, over a fetch that answers the page's
 * three queries and the withdrawal, and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { translatorFor } from "@/i18n/index.ts";
import { People } from "@/routes/People.tsx";
import { trpc } from "@/trpc.ts";

const TENANT = "CASE-0042";
const t = translatorFor("vi");

afterEach(cleanup);

function answer(data: unknown): Response {
  return Response.json({ result: { data } });
}

/** Mounts the page as an admin; returns how many withdrawals the server has been sent. */
function mount(
  members: readonly { userId: string; email: string; role: string }[],
  invitations: readonly { id: string; email: string; role: string }[] = [],
): { withdrawals: () => number } {
  let withdrawals = 0;
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
          if (path.endsWith("/people.members")) {
            return Promise.resolve(answer(members));
          }
          if (path.endsWith("/people.invitations")) {
            return Promise.resolve(
              answer(
                invitations.map((row) => ({
                  ...row,
                  status: "pending",
                  expiresAt: "2026-10-07T03:00:00.000Z",
                })),
              ),
            );
          }
          if (path.endsWith("/people.revokeInvitation")) {
            withdrawals += 1;
            return Promise.resolve(answer({ ok: true }));
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
          <People tenantId={TENANT} />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { withdrawals: () => withdrawals };
}

/** The two controls an admin is offered on a member's row, by the address they act on. */
function offered(email: string): { roleSelect: boolean; remove: boolean } {
  return {
    roleSelect: screen.queryByLabelText(t("people.roleFor", { email })) !== null,
    remove: screen.queryByText(t("people.removeConfirm", { email })) !== null,
  };
}

describe("the last admin", () => {
  it("is marked, and offered neither a lower role nor removal, while other members keep both", async () => {
    mount([
      { userId: "u1", email: "ada@example.test", role: "admin" },
      { userId: "u2", email: "bo@example.test", role: "member" },
    ]);

    expect(await screen.findByText(t("people.lastAdmin"))).toBeDefined();
    expect(offered("ada@example.test")).toEqual({ roleSelect: false, remove: false });
    expect(offered("bo@example.test")).toEqual({ roleSelect: true, remove: true });
  });

  it("is not a thing when two members are admin: both are offered both", async () => {
    mount([
      { userId: "u1", email: "ada@example.test", role: "admin" },
      { userId: "u2", email: "bo@example.test", role: "admin" },
    ]);

    await screen.findByLabelText(t("people.roleFor", { email: "ada@example.test" }));
    expect(screen.queryByText(t("people.lastAdmin"))).toBeNull();
    expect(offered("ada@example.test")).toEqual({ roleSelect: true, remove: true });
    expect(offered("bo@example.test")).toEqual({ roleSelect: true, remove: true });
  });
});

it("withdrawing an invitation sends nothing until the second press, which names the address", async () => {
  const server = mount(
    [{ userId: "u1", email: "ada@example.test", role: "admin" }],
    [{ id: "5b0c1c9e-3f0a-4d8e-9d6a-2a1f4c7e8b10", email: "acme@example.test", role: "viewer" }],
  );

  fireEvent.click(await screen.findByText(t("people.withdraw")));
  const confirm = screen.getByRole("button", {
    name: t("people.withdrawConfirm", { email: "acme@example.test" }),
  });
  const sentAfterFirstPress = server.withdrawals();
  fireEvent.click(confirm);

  expect(sentAfterFirstPress).toBe(0);
  await waitFor(() => {
    expect(server.withdrawals()).toBe(1);
  });
});
