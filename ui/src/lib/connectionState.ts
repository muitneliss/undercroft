/**
 * What a connection card says, in each state it can be in.
 *
 * Six states, each with its own copy and its own next action — not one badge
 * whose colour changes. The distinction that earns its keep is between
 * `needs_scope` and `needs_reconnect`: both look like "not working yet" and they
 * ask the operator for completely different things.
 *
 * `needs_reconnect` is the state that actually happens in production. Xero's
 * refresh token dies after 60 days unused, and a customer can revoke a Google
 * grant from their own account page without telling anyone. So it gets the
 * clearest recovery path, not the smallest badge.
 *
 * Expiry is computed here rather than in a component so it is testable without
 * rendering, and so "expired" is decided in one place.
 */

import type { Connection } from "@/api/types";

export type CardState =
  | "not_connected"
  | "connected"
  | "needs_scope"
  | "needs_reconnect"
  | "expired";

export type CardPresentation = {
  state: CardState;
  headline: string;
  detail: string;
  /** The single thing to do next. Null when there is nothing to do. */
  action: { label: string; kind: "connect" | "scope" | "reconnect" } | null;
  tone: "positive" | "negative" | "attention" | "neutral";
  /** Whether this card counts as done on the setup checklist. */
  complete: boolean;
};

export function presentConnection(connection: Connection, now = new Date()): CardPresentation {
  const expiry = connection.expires_at ? new Date(connection.expires_at) : null;
  // A null expiry means "no expiry recorded" -- a HubSpot private-app token
  // genuinely never expires. Treating null as expired would demand a reconnect
  // for a connection that works.
  const hasExpired = expiry !== null && expiry.getTime() <= now.getTime();

  if (connection.status === "needs_reconnect" || (hasExpired && connection.status !== "disconnected")) {
    return {
      state: hasExpired && connection.status !== "needs_reconnect" ? "expired" : "needs_reconnect",
      headline: "Reconnect needed",
      detail:
        "The access we were granted has lapsed or been withdrawn. Nothing has been lost — reconnecting picks up where the last sync finished.",
      action: { label: "Reconnect", kind: "reconnect" },
      tone: "negative",
      complete: false,
    };
  }

  switch (connection.status) {
    case "disconnected":
      return {
        state: "not_connected",
        headline: "Not connected",
        detail: "",
        action: { label: "Connect", kind: "connect" },
        tone: "neutral",
        complete: false,
      };

    case "needs_scope":
      return {
        state: "needs_scope",
        headline: "Choose what to sync",
        detail:
          connection.external_account_label === ""
            ? "Connected. Tell us which account to read before the first sync."
            : `Connected to ${connection.external_account_label}. Choose what to sync before the first run.`,
        action: { label: "Choose", kind: "scope" },
        tone: "attention",
        complete: false,
      };

    case "connected":
      return {
        state: "connected",
        headline: connection.external_account_label || "Connected",
        detail: "Syncing on schedule.",
        action: null,
        tone: "positive",
        complete: true,
      };

    default: {
      const exhaustive: never = connection.status;
      throw new Error(`unhandled connection status ${String(exhaustive)}`);
    }
  }
}

/** How far through setup this tenant is. Drives the checklist's headline. */
export function setupProgress(connections: Connection[]): {
  done: number;
  total: number;
  finished: boolean;
} {
  const done = connections.filter((c) => presentConnection(c).complete).length;
  return { done, total: connections.length, finished: done === connections.length && done > 0 };
}
