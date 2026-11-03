/**
 * The customer index's band of everyone on the platform (ADR 0152): a superadmin is offered
 * Deactivate behind a second press for everybody but themselves, Reactivate for a person already
 * deactivated, and is told what the press revoked; anybody else is offered none of it, and the
 * page never asks for the list.
 *
 * No mocks: the real route, tRPC client and react-query over an in-memory server that answers the
 * procedures named here and refuses every other (`test/mountRoute.tsx`).
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import "@/i18n/index.ts";
import { Tenants } from "@/routes/Tenants.tsx";
import { mountRoute } from "@/test/mountRoute.tsx";

afterEach(() => {
  cleanup();
});

const JOINED = "2026-09-01T02:00:00.000Z";

const PEOPLE = [
  { userId: "u-root", email: "root@example.test", createdAt: JOINED, memberships: 0 },
  { userId: "u-ada", email: "ada@example.test", createdAt: JOINED, memberships: 2 },
  {
    userId: "u-gone",
    email: "gone@example.test",
    createdAt: JOINED,
    memberships: 1,
    deactivatedAt: "2026-10-01T02:00:00.000Z",
  },
].map((person) => ({ deactivatedAt: null, ...person }));

function openTenants(superadmin: boolean): ReturnType<typeof mountRoute> {
  return mountRoute({
    pattern: "/tenants",
    url: "/tenants",
    element: <Tenants />,
    answers: {
      "tenants.list": () => [],
      "session.me": () => ({ userId: "u-root", email: "root@example.test", superadmin }),
      "users.list": () => PEOPLE,
      "users.deactivate": () => ({
        email: "ada@example.test",
        deactivatedAt: "2026-10-06T02:00:00.000Z",
        revoked: { tokens: 2, sessions: 1, refreshTokens: 3, consents: 1 },
      }),
    },
  });
}

describe("everyone on the platform, for a superadmin", () => {
  it("deactivates a person on the second press, and says what it revoked", async () => {
    const { received } = openTenants(true);

    fireEvent.click(await screen.findByText("Ngừng kích hoạt…"));
    fireEvent.click(screen.getByRole("button", { name: "Ngừng kích hoạt ada@example.test" }));

    expect(
      await screen.findByText(
        "ada@example.test đã bị ngừng kích hoạt. Đã thu hồi — token: 2 · phiên đăng nhập: 1 · ứng dụng đã kết nối: 1.",
      ),
    ).toBeDefined();
    expect(received.filter((request) => request.path === "users.deactivate")).toEqual([
      { path: "users.deactivate", input: { email: "ada@example.test" } },
    ]);
  });

  it("offers the reader no control over their own row, and Reactivate for one deactivated", async () => {
    openTenants(true);

    await screen.findByText("Mọi người trên nền tảng");

    expect({
      deactivate: screen.getAllByText("Ngừng kích hoạt…").length,
      reactivate: screen.getAllByRole("button", { name: "Kích hoạt lại" }).length,
    }).toEqual({ deactivate: 1, reactivate: 1 });
  });
});

describe("everyone on the platform, for anybody else", () => {
  it("is not shown, and the page never asks for it", async () => {
    const { received } = openTenants(false);

    await screen.findByText("Hồ sơ khách hàng");
    await waitFor(() => {
      expect(received.some((request) => request.path === "session.me")).toBe(true);
    });

    expect({
      band: screen.queryByText("Mọi người trên nền tảng"),
      asked: received.some((request) => request.path === "users.list"),
    }).toEqual({ band: null, asked: false });
  });
});
