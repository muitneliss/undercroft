/**
 * What the card tells someone before they hand over access.
 *
 * The design problem this file guards is consent, not layout. A client admin is
 * about to grant read access to their company email or their accounting system.
 * If the card says only "Connect Gmail", they have no basis for the decision,
 * and a later "why does this have my email?" is entirely fair.
 *
 * So: what is read, that nothing is written, and that it can be undone — on the
 * card, before the redirect. These tests fail if that copy is ever dropped as
 * clutter.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { ConnectionCard } from "@/components/ConnectionCard";
import { connection } from "@/test/store";
import { renderApp } from "@/test/render";

const noop = () => undefined;

function show(conn: Parameters<typeof ConnectionCard>[0]["connection"]) {
  return renderApp(
    <ConnectionCard
      connection={conn}
      onConnect={noop}
      onScope={noop}
      onDisconnect={noop}
    />,
  );
}

describe("before connecting", () => {
  test("says what will be read", () => {
    show(connection("gmail"));

    expect(screen.getByText(/message headers and pdf attachments/i)).toBeInTheDocument();
  });

  test("says that nothing will be changed and it can be undone", () => {
    show(connection("xero"));

    expect(screen.getByText(/read-only access, and you can disconnect at any time/i)).toBeInTheDocument();
  });

  test("tells a Drive user that only selected folders are read", () => {
    show(connection("drive"));

    expect(screen.getByText(/no other folder is read/i)).toBeInTheDocument();
  });

  test("offers connecting as the only action", () => {
    show(connection("hubspot"));

    expect(screen.getByRole("button", { name: /connect hubspot/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
  });
});

describe("once connected", () => {
  test("names the account so a wrong one is obvious", () => {
    show(
      connection("xero", {
        status: "connected",
        external_account_label: "CASE-A1B2C3 Pte Ltd",
      }),
    );

    expect(screen.getByText("CASE-A1B2C3 Pte Ltd")).toBeInTheDocument();
  });

  test("stops repeating the access explanation", () => {
    // It was the basis for a decision already made; leaving it is noise.
    show(connection("gmail", { status: "connected", external_account_label: "ops@example.test" }));

    expect(screen.queryByText(/what we read/i)).not.toBeInTheDocument();
  });

  test("offers disconnecting", () => {
    show(connection("gmail", { status: "connected" }));

    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });
});

describe("the two states that are easy to confuse", () => {
  test("awaiting a scope asks for a decision", async () => {
    let asked = false;
    renderApp(
      <ConnectionCard
        connection={connection("drive", { status: "needs_scope" })}
        onConnect={noop}
        onScope={() => (asked = true)}
        onDisconnect={noop}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /choose what to sync/i }));

    expect(asked).toBe(true);
  });

  test("a revoked grant asks for a reconnect and says nothing was lost", () => {
    show(connection("gmail", { status: "needs_reconnect" }));

    expect(screen.getByRole("button", { name: /reconnect gmail/i })).toBeInTheDocument();
    expect(screen.getByText(/picks up where the last sync finished/i)).toBeInTheDocument();
  });
});

describe("status is never carried by colour alone", () => {
  test("the badge states its meaning in words", () => {
    show(connection("xero", { status: "needs_reconnect" }));

    // WCAG 2.1 AA 1.4.1. Also what makes a greyscale screenshot legible.
    expect(screen.getByText("Reconnect needed")).toBeInTheDocument();
  });
});
