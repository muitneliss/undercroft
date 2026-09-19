/**
 * What a connection card says, in each state it can be in.
 *
 * Four states, each with its own copy and its own next action — not one badge
 * whose colour changes. The distinction that earns its keep is between
 * `needs_scope` and `needs_reconnect`: both look like "not working yet" and they
 * ask the operator for completely different things.
 *
 * `needs_reconnect` is the state that actually happens in production. Xero's
 * refresh token dies after 60 days unused, and a customer can revoke a Google
 * grant from their own account page without telling anyone. So it gets the
 * clearest recovery path, not the smallest badge.
 *
 * ## Whether a grant is finished is not decided here
 *
 * There used to be a fifth state, `expired`, derived from `connection.expiresAt` being in
 * the past. It was a second owner for a decision that already had one, and it was wrong: the
 * timestamp it read is the access token's hourly rotation, not the grant's end. Every
 * freshly consented Google connection turned itself into "reconnect" about an hour later,
 * for a credential the worker refreshes on its own.
 *
 * A grant is finished when a refresh FAILS, which is a fact only the worker can observe. It
 * records that by setting the connection `expired`, `services/connections.ts` presents it as
 * `needs_reconnect`, and this module believes the status it is handed. A clock in the browser
 * cannot see a revocation and must not guess at one.
 *
 * ## Which state it is, and what that state is called, are two questions
 *
 * `connectionFacts` answers the first and knows no words at all; `presentConnection` adds
 * the second from the catalogue it is handed. Keeping them apart is what lets
 * `setupProgress` count finished sources without a translator in scope -- a progress count
 * that needed a language to be computed would be a decision taken in the wrong place.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { TFunction } from "i18next";

import type { Connection } from "@/api/types.ts";

export type CardState = "not_connected" | "connected" | "needs_scope" | "needs_reconnect";

/** The single thing to do next, as a decision rather than as a button label. */
export type ActionKind = "connect" | "scope" | "reconnect";

export interface CardFacts {
  state: CardState;
  /** What to do next, or null when there is nothing to do. */
  actionKind: ActionKind | null;
  /**
   * Which printed mark this state carries.
   *
   * Four distinct geometries rather than four tints of one shape -- solid, half,
   * struck, open -- so a schedule of grants survives greyscale and colour
   * blindness, and the hue is the third carrier of the state rather than the
   * only one.
   */
  mark: "granted" | "pending" | "lapsed" | "absent";
  /** Whether this card counts as done on the setup checklist. */
  complete: boolean;
}

export type CardPresentation = CardFacts & {
  headline: string;
  detail: string;
  /** The next action, named for the reader. Null when there is nothing to do. */
  action: { label: string; kind: ActionKind } | null;
};

/**
 * Which state a grant is in. No words, and therefore no language.
 *
 * Takes no clock, deliberately. Every question it answers is already decided in the status
 * it is handed, and the parameter it used to take was the seam the expiry bug came in
 * through. See the module docstring.
 */
export function connectionFacts(connection: Connection): CardFacts {
  switch (connection.status) {
    case "needs_reconnect":
      return { state: "needs_reconnect", actionKind: "reconnect", mark: "lapsed", complete: false };

    case "disconnected":
      return { state: "not_connected", actionKind: "connect", mark: "absent", complete: false };

    case "needs_scope":
      return { state: "needs_scope", actionKind: "scope", mark: "pending", complete: false };

    case "connected":
      return { state: "connected", actionKind: null, mark: "granted", complete: true };

    default: {
      const exhaustive: never = connection.status;
      throw new Error(`unhandled connection status ${String(exhaustive)}`);
    }
  }
}

const ACTION_LABEL: Record<
  ActionKind,
  "grantState.actionConnect" | "grantState.actionChoose" | "grantState.actionReconnect"
> = {
  connect: "grantState.actionConnect",
  scope: "grantState.actionChoose",
  reconnect: "grantState.actionReconnect",
};

/** The card's state, with the words a reader of `t`'s language sees. */
export function presentConnection(t: TFunction, connection: Connection): CardPresentation {
  const card = connectionFacts(connection);
  const action =
    card.actionKind === null
      ? null
      : { label: t(ACTION_LABEL[card.actionKind]), kind: card.actionKind };

  switch (card.state) {
    case "needs_reconnect":
      return {
        ...card,
        headline: t("grantState.lapsedHeadline"),
        detail: t("grantState.lapsedDetail"),
        action,
      };

    case "not_connected":
      return { ...card, headline: t("grantState.notConnectedHeadline"), detail: "", action };

    case "needs_scope":
      return {
        ...card,
        headline: t("grantState.needsScopeHeadline"),
        detail:
          connection.externalAccountLabel === ""
            ? t("grantState.needsScopeDetail")
            : t("grantState.needsScopeDetailNamed", {
                account: connection.externalAccountLabel,
              }),
        action,
      };

    case "connected":
      return {
        ...card,
        // The account's own name where there is one: an operator on a call needs to know
        // *which* mailbox is connected, not merely that one is.
        headline: connection.externalAccountLabel || t("grantState.connectedHeadline"),
        detail: t("grantState.connectedDetail"),
        action,
      };

    default: {
      const exhaustive: never = card.state;
      throw new Error(`unhandled card state ${String(exhaustive)}`);
    }
  }
}

/**
 * What a live grant actually permits, in the customer's words.
 *
 * The schedule answers who granted what, when it expires and when it next runs,
 * and for a long time it did not answer *over which scope* -- which is half the
 * custody question this product exists to hold. The access statement covers it
 * before the grant is made; this covers it for the years afterwards.
 *
 * Returns null when nothing is recorded rather than describing the widest
 * possible reading. A scope we cannot name is not a scope of everything, and the
 * caller renders the absence as MISSING.
 */
export function scopeSummary(t: TFunction, connection: Connection): string | null {
  const folders = connection.config.folderIds ?? [];
  const labels = connection.config.labels ?? [];
  const entities = connection.config.entities ?? [];

  switch (connection.source) {
    case "drive":
      if (folders.length === 0) {
        return null;
      }
      return t("scope.driveFolders", { count: folders.length });

    case "gmail":
      // An empty label list is a recorded decision here, not a missing one: the
      // scope form says so in as many words before it saves.
      return labels.length === 0
        ? t("scope.gmailWholeMailbox")
        : t("scope.gmailLabels", { labels: labels.join(", ") });

    case "hubspot":
    case "xero":
      return entities.length === 0 ? null : entities.join(", ");

    default: {
      const exhaustive: never = connection.source;
      throw new Error(`unhandled source ${String(exhaustive)}`);
    }
  }
}

/** How far through setup this tenant is. Drives the checklist's headline. */
export function setupProgress(connections: Connection[]): {
  done: number;
  total: number;
  finished: boolean;
} {
  const done = connections.filter((c) => connectionFacts(c).complete).length;
  return { done, total: connections.length, finished: done === connections.length && done > 0 };
}
