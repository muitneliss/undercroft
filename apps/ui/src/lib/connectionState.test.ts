/**
 * The six connection states, and the two that are easy to conflate.
 *
 * `needs_scope` and `needs_reconnect` both look like "not working yet" and ask
 * the operator for completely different things — one wants a decision, the other
 * wants a trip through a consent screen. Collapsing them produces a card that
 * says "fix this" and cannot say how.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";

import { connection } from "@/test/fixtures.ts";
import { presentConnection, setupProgress } from "./connectionState.ts";

const NOW = new Date("2026-09-17T12:00:00Z");

describe("presentConnection", () => {
  it("an unconnected source offers to connect", () => {
    const card = presentConnection(connection("xero"), NOW);

    expect(card.state).toBe("not_connected");
    expect(card.action?.kind).toBe("connect");
    expect(card.complete).toBe(false);
  });

  it("a connected source with a chosen scope is done", () => {
    const card = presentConnection(
      connection("xero", { status: "connected", external_account_label: "CASE-A1B2C3 Pte Ltd" }),
      NOW,
    );

    expect(card.state).toBe("connected");
    expect(card.action).toBeNull();
    expect(card.complete).toBe(true);
  });

  it("a source awaiting its scope asks for a decision, not a reconnect", () => {
    const card = presentConnection(connection("drive", { status: "needs_scope" }), NOW);

    expect(card.state).toBe("needs_scope");
    expect(card.action?.kind).toBe("scope");
  });

  it("a revoked grant asks for a reconnect, not a decision", () => {
    const card = presentConnection(connection("gmail", { status: "needs_reconnect" }), NOW);

    expect(card.state).toBe("needs_reconnect");
    expect(card.action?.kind).toBe("reconnect");
  });

  it("an expired credential needs reconnecting even if the status still says connected", () => {
    // Xero's refresh token dies after 60 days unused and nothing tells us.
    const card = presentConnection(
      connection("xero", { status: "connected", expires_at: "2026-09-17T11:00:00Z" }),
      NOW,
    );

    expect(card.complete).toBe(false);
    expect(card.action?.kind).toBe("reconnect");
  });

  it("a credential with no recorded expiry is not treated as expired", () => {
    // A HubSpot private-app token genuinely does not expire. Demanding a
    // reconnect for it would break a connection that works.
    const card = presentConnection(
      connection("hubspot", { status: "connected", expires_at: null }),
      NOW,
    );

    expect(card.state).toBe("connected");
    expect(card.complete).toBe(true);
  });

  it("a credential expiring later today is still fine now", () => {
    const card = presentConnection(
      connection("xero", { status: "connected", expires_at: "2026-09-17T23:00:00Z" }),
      NOW,
    );

    expect(card.state).toBe("connected");
  });

  it("every state offers exactly one next action, or none when complete", () => {
    const states = ["disconnected", "connected", "needs_scope", "needs_reconnect"] as const;

    for (const status of states) {
      const card = presentConnection(connection("xero", { status }), NOW);
      expect(card.headline).not.toBe("");
      if (card.complete) {
        expect(card.action).toBeNull();
      } else {
        expect(card.action).not.toBeNull();
      }
    }
  });
});

describe("setupProgress", () => {
  it("counts only the sources that are actually usable", () => {
    const progress = setupProgress([
      connection("hubspot", { status: "connected" }),
      connection("xero", { status: "needs_scope" }),
      connection("gmail"),
      connection("drive"),
    ]);

    expect(progress).toEqual({ done: 1, total: 4, finished: false });
  });

  it("is finished only when every source is connected", () => {
    const all = (["hubspot", "xero", "gmail", "drive"] as const).map((s) =>
      connection(s, { status: "connected" }),
    );

    expect(setupProgress(all).finished).toBe(true);
  });

  it("an empty list is not finished", () => {
    // Otherwise a tenant whose connections failed to load renders as complete.
    expect(setupProgress([]).finished).toBe(false);
  });
});
