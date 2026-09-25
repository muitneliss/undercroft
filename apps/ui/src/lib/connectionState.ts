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
 *
 * ## One card per ACCOUNT, one switcher per kind
 *
 * A tenant may hold several Gmail mailboxes and several Drive accounts (ADR 0043), and the
 * server lists each as a card of its own, because one status over two mailboxes could not say
 * which of them stopped. `groupByKind`, `selectedFor` and `offersAccounts` decide how those
 * cards are gathered and which one is on show; the choice itself is the reader's, kept in the
 * store (`selectedAccount`), and what these functions add to it is the fallback.
 */

import { MULTI_ACCOUNT_KINDS } from "@undercroft/contracts/sources";
import type { TFunction } from "i18next";

import type { Connection, Source } from "@/api/types.ts";
import { describeXeroEntity } from "@/lib/xeroEntities.ts";

export type CardState = "not_connected" | "connected" | "needs_scope" | "needs_reconnect";

/**
 * How a source is connected: through a provider's consent screen, or by a token an admin
 * pastes. HubSpot has no consent to run -- a private app issues a token -- so its card
 * opens a form in the row where the others send the browser away. Wordless, so the card
 * test can ask it with no translator in scope.
 */
export function connectsBy(kind: Source): "consent" | "token" {
  return kind === "hubspot" ? "token" : "consent";
}

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

/**
 * The facts plus the one sentence the card prints beneath them.
 *
 * No headline and no action label: the card's heading is the source's own name, and each
 * plate writes its own words (`grant.connect`, `grant.chooseScope`, ...). Both used to be
 * computed here and rendered by nothing, which left a translated catalogue entry that no
 * reader ever saw and no test could miss.
 */
export type CardPresentation = CardFacts & {
  detail: string;
  /** The next action. Null when there is nothing to do. */
  action: { kind: ActionKind } | null;
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

/**
 * The word printed beside each mark. One table, because the card and the account switcher
 * both print a grant's mark, and two tables would be two chances for them to disagree.
 */
export const MARK_LABEL = {
  granted: "grant.markGranted",
  pending: "grant.markPending",
  lapsed: "grant.markLapsed",
  absent: "grant.markAbsent",
} as const satisfies Record<CardFacts["mark"], string>;

/** The card's state, with the words a reader of `t`'s language sees. */
export function presentConnection(t: TFunction, connection: Connection): CardPresentation {
  const card = connectionFacts(connection);
  const action = card.actionKind === null ? null : { kind: card.actionKind };

  switch (card.state) {
    case "needs_reconnect":
      return { ...card, detail: t("grantState.lapsedDetail"), action };

    case "not_connected":
      return { ...card, detail: "", action };

    case "needs_scope":
      return {
        ...card,
        detail:
          connection.externalAccountLabel === ""
            ? t("grantState.needsScopeDetail")
            : t("grantState.needsScopeDetailNamed", {
                account: connection.externalAccountLabel,
              }),
        action,
      };

    case "connected":
      return { ...card, detail: t("grantState.connectedDetail"), action };

    default: {
      const exhaustive: never = card.state;
      throw new Error(`unhandled card state ${String(exhaustive)}`);
    }
  }
}

/**
 * What a Drive grant permits, which is a folder count AND how deep the read goes.
 *
 * The depth is the difference between "the folder" and "the folder and everything under it",
 * and one sentence for both would leave an admin to discover which they chose by reading a
 * run. A selection of loose documents with no folder in it gets its own sentence rather than
 * "0 selected folders". ADR 0031.
 */
function driveScope(t: TFunction, config: Connection["config"]): string | null {
  const picks = config.files ?? [];
  const folders = picks.filter((pick) => pick.kind === "folder");

  if (picks.length === 0) {
    return null;
  }
  if (folders.length === 0) {
    return t("scope.driveFiles", { count: picks.length });
  }
  return config.recurse === true
    ? t("scope.driveFoldersDeep", { count: folders.length })
    : t("scope.driveFolders", { count: folders.length });
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
  const labels = connection.config.labels ?? [];
  const entities = connection.config.entities ?? [];

  switch (connection.kind) {
    case "drive":
      return driveScope(t, connection.config);

    case "gmail":
      // An empty label list is a recorded decision here, not a missing one: the
      // scope form says so in as many words before it saves.
      return labels.length === 0
        ? t("scope.gmailWholeMailbox")
        : t("scope.gmailLabels", { labels: labels.join(", ") });

    case "xero":
      // An empty list is a recorded decision -- every entity the spec declares -- and the
      // words say so rather than leaving a dash that reads as "nothing chosen".
      return entities.length === 0
        ? t("scope.xeroAll")
        : t("scope.xeroEntities", {
            entities: entities.map((entity) => describeXeroEntity(t, entity)).join(", "),
          });

    case "hubspot": {
      // Nothing chosen is a reading, not an absence: the spec's own properties, which is what a
      // HubSpot connection has always read. It gets words rather than a dash for that reason.
      const chosen = Object.values(connection.config.properties ?? {}).reduce(
        (count, names) => count + names.length,
        0,
      );
      return chosen === 0
        ? t("scope.hubspotStandard")
        : t("scope.hubspotChosen", { count: chosen });
    }

    default: {
      const exhaustive: never = connection.kind;
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

/**
 * The accounts of one kind, in the order the server listed them. Never empty: a kind appears
 * because at least one card of it came back, so "which account is shown" always has an answer.
 */
export interface KindAccounts {
  readonly kind: Source;
  readonly accounts: readonly [Connection, ...Connection[]];
}

/**
 * The schedule's cards, gathered by what they are.
 *
 * The server already orders them -- kinds in its own order, each kind's first account first
 * and the rest by address (`services/connections.ts`) -- and that order is kept rather than
 * re-decided here, so the browser and the server cannot disagree about which account is "the
 * first".
 */
export function groupByKind(connections: readonly Connection[]): KindAccounts[] {
  const groups = new Map<Source, [Connection, ...Connection[]]>();
  for (const connection of connections) {
    const held = groups.get(connection.kind);
    if (held === undefined) {
      groups.set(connection.kind, [connection]);
    } else {
      held.push(connection);
    }
  }
  return [...groups].map(([kind, accounts]) => ({ kind, accounts }));
}

/**
 * Which account of a kind is on show: the one the reader chose, while it is still there, and
 * otherwise the first.
 *
 * The default is derived, never stored. A stored default would be a second answer to "which is
 * first" that goes stale the moment an account is disconnected; a choice that names an
 * account no longer listed falls back rather than showing nothing.
 */
export function selectedFor(
  accounts: KindAccounts["accounts"],
  chosen: string | undefined,
): Connection {
  return accounts.find((account) => account.source === chosen) ?? accounts[0];
}

/**
 * Whether a kind offers a choice of account, and the plate that adds one.
 *
 * Only Gmail and Drive may hold several (`MULTI_ACCOUNT_KINDS`), and only once one is actually
 * held. A kind nobody has connected comes back as a single blank card the server synthesised
 * -- disconnected, with no address -- and the offer there is the card's own Connect plate:
 * "add ANOTHER account" over no account at all would be a second button for the same consent.
 * A disconnected account that still carries its address is real (its history is its own, and
 * it can be reconnected), so it keeps the switcher.
 */
export function offersAccounts(group: KindAccounts): boolean {
  const [first] = group.accounts;
  const blank = first.status === "disconnected" && first.externalAccountLabel === "";
  return MULTI_ACCOUNT_KINDS.has(group.kind) && (group.accounts.length > 1 || !blank);
}
