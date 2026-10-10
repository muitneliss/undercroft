/**
 * What the consent page promises a person choosing a grant (issue #427): beside "read" and
 * "read and write" it names the role they hold in each customer and what that role allows, and
 * a viewer in every customer is told that write adds nothing there beyond their own account.
 * The note is a guard, so it is pinned from both sides: it fires for a viewer everywhere and
 * stays quiet for a person who is admin somewhere.
 *
 * No mocks: the real route, tRPC client and react-query over an in-memory server that answers
 * the procedures named here and refuses every other (`test/mountRoute.tsx`).
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, screen } from "@testing-library/react";

import "@/i18n/index.ts";
import { vi } from "@/i18n/vi.ts";
import { Consent } from "@/routes/Consent.tsx";
import { mountRoute } from "@/test/mountRoute.tsx";

afterEach(cleanup);

function openConsent(tenants: readonly { id: string; displayName: string; role: string }[]) {
  return mountRoute({
    pattern: "/consent",
    url: "/consent?scope=undercroft%3Aread%20undercroft%3Awrite",
    element: <Consent signedInAs="ada@example.test" />,
    answers: {
      "session.me": () => ({ userId: "u-ada", email: "ada@example.test", superadmin: false }),
      "tenants.list": () => tenants.map((tenant) => ({ ...tenant, deactivatedAt: null })),
    },
  });
}

/** What the page says a role reaches: the line beside the role's own word. */
function reachOf(role: string): string | null | undefined {
  return screen.getByText(role, { selector: "dt" }).nextElementSibling?.textContent;
}

describe("the reach beside the grant", () => {
  it("tells a viewer in every customer that write adds nothing there but their own account", async () => {
    openConsent([{ id: "CASE-0042", displayName: "Hồ sơ Đỏ", role: "viewer" }]);

    expect(await screen.findByText(vi.grantReach.viewerEverywhere)).toBeDefined();
    expect(reachOf("viewer")).toBe(`Tại Hồ sơ Đỏ.${vi.people.rightsViewer}`);
    // Still offered: write is valid for their own account, and a role can rise.
    expect(screen.getByRole("radio", { name: "Đọc và ghi" })).toBeDefined();
  });

  it("names each role with its customers, and no viewer note for someone who is admin somewhere", async () => {
    openConsent([
      { id: "CASE-0042", displayName: "Hồ sơ Đỏ", role: "admin" },
      { id: "CASE-0108", displayName: "", role: "viewer" },
    ]);

    expect(await screen.findByText("admin", { selector: "dt" })).toBeDefined();
    expect(reachOf("admin")).toBe(`Tại Hồ sơ Đỏ.${vi.people.rightsAdmin}`);
    expect(reachOf("viewer")).toBe(`Tại CASE-0108.${vi.people.rightsViewer}`);
    expect(screen.queryByText(vi.grantReach.viewerEverywhere)).toBeNull();
  });
});
