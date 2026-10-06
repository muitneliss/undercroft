/**
 * What the account page's activity band promises (ADR 0112): a person reads their own actions in
 * their language, a refusal with the server's own reason, an action no catalogue knows by its
 * name; older pages are fetched on asking; and only a superadmin is offered every customer's log.
 *
 * No mocks: the real route, tRPC client and react-query over an in-memory server that answers the
 * procedures named here and refuses every other (`test/mountRoute.tsx`).
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import "@/i18n/index.ts";
import { Account } from "@/routes/Account.tsx";
import { mountRoute } from "@/test/mountRoute.tsx";

afterEach(cleanup);

const ROW = {
  at: "2026-10-06T02:00:00.000Z",
  tenantId: "CASE-0042",
  actor: "ada@example.test",
  userId: "u-ada",
  credential: null,
  reason: null,
  detail: {},
};

function openAccount(superadmin: boolean, pages: Record<string, unknown>) {
  return mountRoute({
    pattern: "/account",
    url: "/account",
    element: <Account signedInAs="ada@example.test" />,
    answers: {
      "session.me": () => ({ userId: "u-ada", email: "ada@example.test", superadmin }),
      "account.tokens.list": () => [],
      "account.apps.list": () => [],
      "audit.mine": (input) => pages[(input as { cursor?: string }).cursor ?? "first"],
      "audit.all": () => ({ items: [], nextCursor: null }),
    },
  });
}

describe("your own activity", () => {
  it("names each action in your language, and a refusal by the server's reason", async () => {
    openAccount(false, {
      first: {
        items: [
          {
            ...ROW,
            id: "3",
            action: "people.invite",
            channel: "mcp",
            outcome: "refused",
            reason: "WRITES_DISABLED",
          },
          {
            ...ROW,
            id: "2",
            action: "people.setRole",
            channel: "web",
            outcome: "ok",
            detail: { email: "bob@example.test", role: "admin" },
          },
          { ...ROW, id: "1", action: "legacy.thing", channel: null, outcome: "ok" },
        ],
        nextCursor: null,
      },
    });

    expect(await screen.findByText("Mời một người")).toBeDefined();
    expect(screen.getByText("Bị từ chối")).toBeDefined();
    expect(screen.getByText("WRITES_DISABLED")).toBeDefined();
    expect(screen.getByText("bob@example.test · admin")).toBeDefined();
    expect(screen.getByText("legacy.thing")).toBeDefined();
  });

  it("fetches older actions only when asked, from where the last page ended", async () => {
    const { received } = openAccount(false, {
      first: {
        items: [{ ...ROW, id: "9", action: "auth.signIn", channel: "web", outcome: "ok" }],
        nextCursor: "9",
      },
      "9": {
        items: [{ ...ROW, id: "4", action: "session.signOut", channel: "web", outcome: "ok" }],
        nextCursor: null,
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Xem thêm" }));

    expect(await screen.findByText("Đăng xuất")).toBeDefined();
    const asked = received.filter((request) => request.path === "audit.mine");
    expect(asked.map((request) => (request.input as { cursor?: string }).cursor)).toEqual([
      undefined,
      "9",
    ]);
  });
});

describe("every customer's activity", () => {
  it("is offered to a superadmin, and opens the whole platform's log", async () => {
    const { received } = openAccount(true, { first: { items: [], nextCursor: null } });

    fireEvent.click(await screen.findByRole("link", { name: "Mọi khách hàng" }));

    await waitFor(() => {
      expect(received.map((request) => request.path)).toContain("audit.all");
    });
  });

  it("is not offered to anybody else", async () => {
    openAccount(false, { first: { items: [], nextCursor: null } });

    expect(await screen.findByText("Chưa có hoạt động nào.")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Mọi khách hàng" })).toBeNull();
  });
});
