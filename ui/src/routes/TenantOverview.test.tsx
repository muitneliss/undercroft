/**
 * The onboarding checklist, driven against the in-memory control plane.
 *
 * These go through the real `api` client and the real request handlers in
 * `@/test/server`, which read and write the same store the real API reads and
 * writes Postgres. Nothing is mocked and nothing asserts that a function was
 * called — the assertions are what a person would see on the screen.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { TenantOverview } from "@/routes/TenantOverview";
import { renderApp } from "@/test/render";
import { CASE_A, connection, store } from "@/test/store";

function show() {
  return renderApp(<TenantOverview tenantId={CASE_A} />);
}

describe("a tenant with nothing connected", () => {
  test("shows all four sources rather than an empty page", async () => {
    // An empty list would read as "nothing to do" on the one screen whose job is
    // to say what to do.
    show();

    expect(await screen.findByRole("heading", { name: "HubSpot" })).toBeInTheDocument();
    for (const name of ["Xero", "Gmail", "Google Drive"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  test("asks the user to finish setting up", async () => {
    show();

    expect(await screen.findByRole("heading", { name: /finish setting up/i })).toBeInTheDocument();
    expect(screen.getByText(/0 of 4 connected/i)).toBeInTheDocument();
  });

  test("does not offer to run a sync there is nothing to sync from", async () => {
    show();

    await screen.findByRole("heading", { name: "HubSpot" });
    expect(screen.queryByRole("button", { name: /run sync now/i })).not.toBeInTheDocument();
    // The header carries the reason, so the absent button is not a dead end.
    expect(screen.getByText(/connect a source to start bringing data in/i)).toBeInTheDocument();
  });
});

describe("as sources are connected", () => {
  test("progress reflects only usable connections", async () => {
    store.connections[CASE_A] = [
      connection("hubspot", { status: "connected" }),
      // Connected but not yet scoped: not usable, so it does not count.
      connection("xero", { status: "needs_scope" }),
      connection("gmail"),
      connection("drive"),
    ];

    show();

    expect(await screen.findByText(/1 of 4 connected/i)).toBeInTheDocument();
  });

  test("offers a sync as soon as one source works", async () => {
    store.connections[CASE_A] = [
      connection("hubspot", { status: "connected" }),
      connection("xero"),
      connection("gmail"),
      connection("drive"),
    ];

    show();

    expect(await screen.findByRole("button", { name: /run sync now/i })).toBeInTheDocument();
  });

  test("stops asking once every source is connected", async () => {
    store.connections[CASE_A] = (["hubspot", "xero", "gmail", "drive"] as const).map((s) =>
      connection(s, { status: "connected" }),
    );

    show();

    expect(await screen.findByRole("heading", { name: /connected sources/i })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("starting a sync", () => {
  test("says the sync started, because there is nothing else to show", async () => {
    // ADR 0007 removed the run ledger, so there is no history to navigate to.
    // Without this confirmation the button is indistinguishable from one that
    // does nothing.
    store.connections[CASE_A] = [
      connection("hubspot", { status: "connected" }),
      connection("xero"),
      connection("gmail"),
      connection("drive"),
    ];

    show();
    await userEvent.click(await screen.findByRole("button", { name: /run sync now/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/sync started/i);
  });
});
