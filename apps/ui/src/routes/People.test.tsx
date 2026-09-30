/**
 * What the People division promises an admin before the server has to refuse them (#348): the
 * customer's only admin is marked and offered neither a lower role nor removal, and
 * withdrawing an invitation takes a second press that names the address. And what its address
 * promises: the view and the search are in it, so a pasted link opens the same list -- and a
 * search narrows what is shown without changing who counts as the last admin.
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
  address = "/",
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
        <MemoryRouter initialEntries={[address]}>
          <People tenantId={TENANT} signedInAs="ada@example.test" />
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
    "/?view=invites",
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

describe("the view in the address", () => {
  const ROSTER = [
    { userId: "u1", email: "ada@example.test", role: "admin" },
    { userId: "u2", email: "bo@example.test", role: "member" },
  ];
  const OPEN = [
    { id: "5b0c1c9e-3f0a-4d8e-9d6a-2a1f4c7e8b10", email: "cy@example.test", role: "viewer" },
  ];

  it("opens on the members, and the invitations plate turns to the invitations alone", async () => {
    mount(ROSTER, OPEN);
    expect(await screen.findByText("bo@example.test")).toBeDefined();
    expect(screen.queryByText("cy@example.test")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: t("people.viewInvites", { count: 1 }) }));

    expect(await screen.findByText("cy@example.test")).toBeDefined();
    expect(screen.queryByText("bo@example.test")).toBeNull();
  });

  it("opens a pasted link on the view it names, and an unknown view on the members", async () => {
    mount(ROSTER, OPEN, "/?view=roles");
    expect(await screen.findByText(t("people.rightsAdmin"))).toBeDefined();
    expect(screen.queryByText("bo@example.test")).toBeNull();
    expect(screen.queryByText("cy@example.test")).toBeNull();
    cleanup();

    mount(ROSTER, OPEN, "/?view=everything");
    expect(await screen.findByText("bo@example.test")).toBeDefined();
  });
});

describe("the search in the address", () => {
  it("shows only the addresses that match, and says so when none do", async () => {
    mount(
      [
        { userId: "u1", email: "ada@example.test", role: "admin" },
        { userId: "u2", email: "bo@example.test", role: "member" },
      ],
      [],
      "/?q=BO",
    );
    expect(await screen.findByText("bo@example.test")).toBeDefined();
    expect(screen.queryByText("ada@example.test")).toBeNull();

    fireEvent.change(screen.getByLabelText(t("people.searchLabel")), {
      target: { value: "nobody" },
    });

    expect(await screen.findByText(t("people.noMatch"))).toBeDefined();
    expect(screen.queryByText("bo@example.test")).toBeNull();
  });

  it("does not make the one admin it shows the last admin: that is asked of the whole roster", async () => {
    mount(
      [
        { userId: "u1", email: "ada@example.test", role: "admin" },
        { userId: "u2", email: "bo@example.test", role: "admin" },
      ],
      [],
      "/?q=ada",
    );

    await screen.findByLabelText(t("people.roleFor", { email: "ada@example.test" }));
    expect(screen.queryByText("bo@example.test")).toBeNull();
    expect(screen.queryByText(t("people.lastAdmin"))).toBeNull();
    expect(offered("ada@example.test")).toEqual({ roleSelect: true, remove: true });
  });
});
