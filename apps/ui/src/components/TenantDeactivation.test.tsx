/**
 * What opening a deactivated customer's book promises (ADR 0110): the notice stands in for the
 * division and the division asks the server nothing, an admin gets the way back and anybody else
 * is told who has it, and reactivating opens the division again.
 *
 * No mocks: the real book, route, tRPC client and react-query over an in-memory server that
 * answers the procedures named here and refuses every other (`test/mountRoute.tsx`).
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { Opened } from "@/components/Opened.tsx";
import { TenantOverview } from "@/routes/TenantOverview.tsx";
import { held } from "@/test/access.ts";
import { mountRoute } from "@/test/mountRoute.tsx";

const TENANT = "CASE-0042";
const WHEN = "2026-10-01T02:00:00.000Z";

afterEach(cleanup);

/** The Sources division of CASE-0042, read by `role`, deactivated at `deactivatedAt`. */
function openSources(role: "admin" | "member", deactivatedAt: string | null) {
  const state = { deactivatedAt };
  const mounted = mountRoute({
    pattern: "/tenants/:tenantId",
    url: `/tenants/${TENANT}`,
    element: (
      <Opened division="sources" signedInAs="ada@example.test">
        {(tenantId): React.JSX.Element => <TenantOverview tenantId={tenantId} />}
      </Opened>
    ),
    answers: {
      "tenants.get": () => ({
        id: TENANT,
        displayName: "Demo Co.",
        role,
        permissions: held(role),
        ...state,
      }),
      "tenants.reactivate": () => {
        state.deactivatedAt = null;
        return { id: TENANT, displayName: "Demo Co.", deactivatedAt: null };
      },
      "tenants.list": () => [],
      "connections.list": () => [],
      "keys.list": () => [],
    },
  });
  return mounted;
}

describe("a deactivated customer's book", () => {
  it("shows the notice in place of the division, which asks the server nothing", async () => {
    const { received } = openSources("member", WHEN);

    await screen.findByRole("heading", { name: "Khách hàng này đã ngừng kích hoạt" });
    expect(screen.getByText(/Hãy đề nghị một quản trị viên/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Kích hoạt lại" })).toBeNull();
    expect(received.map((request) => request.path)).not.toContain("connections.list");
  });

  it("offers its admin the way back, and the division opens again once taken", async () => {
    const { received } = openSources("admin", WHEN);

    fireEvent.click(await screen.findByRole("button", { name: "Kích hoạt lại" }));

    await screen.findByRole("heading", { name: "Nguồn dữ liệu" });
    expect(received.map((request) => request.path)).toContain("tenants.reactivate");
    expect(screen.queryByText("Khách hàng này đã ngừng kích hoạt")).toBeNull();
  });

  it("is the division itself for a customer in use", async () => {
    const { received } = openSources("member", null);

    await screen.findByRole("heading", { name: "Nguồn dữ liệu" });
    await waitFor(() => {
      expect(received.map((request) => request.path)).toContain("connections.list");
    });
    expect(screen.queryByText("Khách hàng này đã ngừng kích hoạt")).toBeNull();
  });
});
