/**
 * What the People division promises an admin before the server has to refuse them (#348): the
 * customer's only admin is marked and offered neither a lower role nor removal, and
 * withdrawing an invitation takes a second press that names the address. And what its address
 * promises: the view and the search are in it, so a pasted link opens the same list -- and a
 * search narrows what is shown without changing who counts as the last admin.
 *
 * No mocks: the real route, tRPC client and react-query, over a fetch that answers the page's
 * three queries and the withdrawal, and REFUSES every other path.
 *
 * And who may open it at all (ADR 0119): only the customer's admin. That is the book's to
 * decide, so those tests mount the division inside it, tab strip and all.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PERMISSIONS } from "@undercroft/contracts/access";
import { MemoryRouter } from "react-router-dom";

import { Opened } from "@/components/Opened.tsx";
import { translatorFor } from "@/i18n/index.ts";
import { People } from "@/routes/People.tsx";
import { builtInRoles, held } from "@/test/access.ts";
import { mountRoute } from "@/test/mountRoute.tsx";
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
              answer({
                tenantId: TENANT,
                displayName: "Acme",
                role: "admin",
                permissions: held("admin"),
              }),
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
          if (path.endsWith("/roles.list")) {
            return Promise.resolve(answer({ roles: builtInRoles(), permissions: PERMISSIONS }));
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

describe("the roles offered", () => {
  it("are the four built-ins, builder among them, on a member's row (ADR 0139)", async () => {
    mount([
      { userId: "u1", email: "ada@example.test", role: "admin" },
      { userId: "u2", email: "bo@example.test", role: "builder" },
    ]);

    const select = await screen.findByLabelText(t("people.roleFor", { email: "bo@example.test" }));
    const offeredRoles = [...select.querySelectorAll("option")].map((option) => option.value);
    expect(offeredRoles).toEqual(["viewer", "member", "builder", "admin"]);
    expect(select instanceof HTMLSelectElement ? select.value : null).toBe("builder");
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
    expect(await screen.findByText(t("roleEditor.caption", { count: 4 }))).toBeDefined();
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

describe("the customer's activity (ADR 0113)", () => {
  /** The division at `?view=activity`, read by `role`, over a server that also answers its log. */
  function openActivity(role: "admin" | "member") {
    return mountRoute({
      pattern: "/",
      url: "/?view=activity",
      element: <People tenantId={TENANT} signedInAs="ada@example.test" />,
      answers: {
        "tenants.get": () => ({
          tenantId: TENANT,
          displayName: "Acme",
          role,
          permissions: held(role),
        }),
        "people.members": () => [{ userId: "u1", email: "ada@example.test", role }],
        "people.invitations": () => [],
        "audit.tenant": () => ({
          items: [
            {
              id: "7",
              at: "2026-10-06T02:00:00.000Z",
              tenantId: TENANT,
              actor: "bo@example.test",
              userId: "u2",
              channel: "assistant",
              credential: null,
              action: "connections.disconnect",
              outcome: "ok",
              reason: null,
              detail: { source: "hubspot" },
            },
          ],
          nextCursor: null,
        }),
      },
    });
  }

  it("is a view for its admin, naming who did each thing and through which door", async () => {
    openActivity("admin");

    expect(await screen.findByText("bo@example.test")).toBeDefined();
    expect(screen.getByText(t("activity.actions.connections_disconnect"))).toBeDefined();
    expect(screen.getByText(t("activity.channel.assistant"))).toBeDefined();
  });

  it("is not offered to a member, whose address naming it opens the members", async () => {
    const { received } = openActivity("member");

    expect(await screen.findByText("ada@example.test")).toBeDefined();
    expect(screen.queryByRole("link", { name: t("people.viewActivity") })).toBeNull();
    expect(received.map((request) => request.path)).not.toContain("audit.tenant");
  });
});

describe("only a holder of people:manage opens it (ADR 0119, ADR 0139)", () => {
  /** The division as the app opens it, inside the book, read by `role`. */
  function openInBook(role: "admin" | "builder" | "member") {
    const mounted = mountRoute({
      pattern: "/tenants/:tenantId/people",
      url: `/tenants/${TENANT}/people`,
      element: (
        <Opened division="people" signedInAs="ada@example.test">
          {(tenantId): React.JSX.Element => (
            <People tenantId={tenantId} signedInAs="ada@example.test" />
          )}
        </Opened>
      ),
      answers: {
        "tenants.get": () => ({
          id: TENANT,
          displayName: "Acme",
          role,
          permissions: held(role),
          deactivatedAt: null,
        }),
        "people.members": () => [{ userId: "u1", email: "ada@example.test", role }],
        "people.invitations": () => [],
      },
    });
    return { ...mounted, strip: screen.getByRole("navigation", { name: t("nav.sections") }) };
  }

  it("shows a member the notice in its place, and asks the server nothing it would refuse", async () => {
    const { received, strip } = openInBook("member");

    await screen.findByRole("heading", {
      name: t("nav.notPermittedHead", { division: t("nav.people") }),
    });
    // People is one of five tabs face-down to a member (ADR 0146); find it by its name.
    const tab = within(strip)
      .getAllByTitle(t("nav.notPermittedTitle"))
      .find((closed) => closed.textContent === `${t("nav.people")}${t("nav.notPermittedHint")}`);
    expect(tab?.getAttribute("aria-disabled")).toBe("true");
    const asked = received.map((request) => request.path);
    expect(asked).not.toContain("people.members");
    expect(asked).not.toContain("people.invitations");
  });

  it("closes to a builder too, and names the permission that would open it", async () => {
    // A builder holds more than a member -- models:write, lake:read -- and still not this.
    // A gate on "holds any permission" would open it; the one on people:manage must not.
    const { received } = openInBook("builder");

    await screen.findByRole("heading", {
      name: t("nav.notPermittedHead", { division: t("nav.people") }),
    });
    expect(
      screen.getByText(
        t("nav.notPermittedLead", {
          tenantId: TENANT,
          role: "builder",
          permission: "people:manage",
          label: t("permission.peopleManage"),
        }),
      ),
    ).toBeDefined();
    expect(received.map((request) => request.path)).not.toContain("people.members");
  });

  it("opens for its admin, whose tab stays a link", async () => {
    const { strip } = openInBook("admin");

    // The division's own heading, which it prints only once the roster and the invitations
    // have answered (the reader's address is in the running head from the start).
    expect(await screen.findByRole("heading", { name: t("people.title") })).toBeDefined();
    expect(within(strip).getByRole("link", { name: t("nav.people") })).toBeDefined();
    expect(within(strip).queryByTitle(t("nav.notPermittedTitle"))).toBeNull();
  });
});
