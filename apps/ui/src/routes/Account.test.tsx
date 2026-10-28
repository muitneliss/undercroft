/**
 * What the account page's activity band promises (ADR 0113): a person reads their own actions in
 * their language, a refusal with the server's own reason, an action no catalogue knows by its
 * name; older pages are fetched on asking; and only a superadmin is offered every customer's log,
 * or agents' calls kept whole (ADR 0151), each unfolded to its bodies exactly as stored.
 *
 * No mocks: the real route, tRPC client and react-query over an in-memory server that answers the
 * procedures named here and refuses every other (`test/mountRoute.tsx`).
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import "@/i18n/index.ts";
import { Account } from "@/routes/Account.tsx";
import { useUiStore } from "@/store.ts";
import { mountRoute } from "@/test/mountRoute.tsx";

afterEach(() => {
  cleanup();
  // The store outlives a test; a call one test unfolded must not arrive open in the next.
  useUiStore.setState({ openCall: null });
});

const ROW = {
  at: "2026-10-06T02:00:00.000Z",
  tenantId: "CASE-0042",
  actor: "ada@example.test",
  userId: "u-ada",
  credential: null,
  reason: null,
  detail: {},
};

const CALL = {
  id: "7",
  at: "2026-10-06T02:00:00.000Z",
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  tenantId: "CASE-0042",
  userId: "u-bob",
  actor: "bob@example.test",
  channel: "mcp",
  credential: "upat_abc",
  path: "lake.query",
  type: "mutation",
  outcome: "ok",
  reason: null,
  durationMs: 41,
  requestBytes: 58,
  requestTruncated: false,
  responseKept: "shape",
  responseBytes: 96,
  responseTruncated: false,
};

function openAccount(superadmin: boolean, pages: Record<string, unknown>, url = "/account") {
  return mountRoute({
    pattern: "/account",
    url,
    element: <Account signedInAs="ada@example.test" />,
    answers: {
      "session.me": () => ({ userId: "u-ada", email: "ada@example.test", superadmin }),
      "account.tokens.list": () => [],
      "account.apps.list": () => [],
      "tenants.list": () => [],
      "audit.mine": (input) => pages[(input as { cursor?: string }).cursor ?? "first"],
      "audit.all": () => ({ items: [], nextCursor: null }),
      "audit.calls.list": () => ({ items: [CALL], nextCursor: null }),
      "audit.calls.get": () => ({
        ...CALL,
        // A figure past a double, as an agent sent it: printed as sent, never re-parsed.
        request: '{"tenantId":"CASE-0042","sql":"select 12345678901234567890 as n"}',
        response: '{"columns":[{"name":"n","type":"numeric"}],"rows":{"count":1}}',
        error: null,
      }),
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
    expect(screen.queryByRole("link", { name: "Lần gọi của tác tử" })).toBeNull();
  });
});

describe("agents' calls", () => {
  it("a superadmin unfolds a call to what it sent and the shape it was answered with", async () => {
    openAccount(true, { first: { items: [], nextCursor: null } });

    fireEvent.click(await screen.findByRole("link", { name: "Lần gọi của tác tử" }));
    fireEvent.click(await screen.findByRole("button", { name: "Truy vấn hồ dữ liệu thô" }));

    expect(await screen.findByText(/"sql": "select 12345678901234567890 as n"/u)).toBeDefined();
    expect(screen.getByText(/chỉ giữ hình dạng: các cột, số dòng/u)).toBeDefined();
    expect(screen.getByText(/"count": 1/u)).toBeDefined();
  });

  it("narrows the list to one caller through the address", async () => {
    const { received } = openAccount(
      true,
      { first: { items: [], nextCursor: null } },
      "/account?log=calls",
    );

    fireEvent.change(await screen.findByLabelText("Email người gọi"), {
      target: { value: "bob@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lọc" }));

    await waitFor(() => {
      const asked = received.filter((request) => request.path === "audit.calls.list");
      expect(asked.at(-1)?.input).toMatchObject({ email: "bob@example.test" });
    });
  });
});
