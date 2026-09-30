/**
 * The plates on one source's row: its one next action, Run now, Change what syncs, the door to
 * its runs, and Disconnect.
 *
 * Every write plate is an admin's and absent, not disabled, for anyone else (`ConnectionCard`'s
 * header says why); `canRun` is the one question, asked here once.
 *
 * DISCONNECT TAKES A SECOND PRESS THAT NAMES THE ACCOUNT. It ends a grant a customer made, and
 * it used to do so on its first press. The first press now hinges a leaf into the row saying
 * that the records already landed stay in the raw lake -- disconnecting ends the reading, never
 * the history (rule 1) -- and the second names the account it ends, the way Remove on the
 * roster names the address (`Roster.tsx`). A fold, never a modal: the page above and below
 * stays in the document and the tab order (DESIGN.md).
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Connection } from "@/api/types.ts";
import { ArrowRight } from "@/components/Icon.tsx";
import { type CardPresentation, connectsBy } from "@/lib/connectionState.ts";
import { journalPath } from "@/lib/runs.ts";

/**
 * Which of this card's own actions is in flight. The card is told rather than asked, because
 * the mutations belong to the page: one action at a time across the whole schedule (`busy`),
 * but only the card it was started from says what is happening.
 */
export type GrantPending = "connect" | "disconnect" | "run" | "cadence" | "resync";

/** What `presentConnection` decided this row says and offers. */
type Card = CardPresentation;

/**
 * The one next action for this state, the two that are always available once granted, and the
 * door to this account's runs.
 *
 * The writes are an admin's and are not drawn for anyone else (see `ConnectionCard`'s header);
 * the door is every reader's. Every state has exactly one primary plate for an admin. That is
 * the point of the state machine in `@/lib/connectionState`: a row offering two
 * equally-weighted next steps is a row whose state nobody decided.
 */
export function GrantActions({
  tenantId,
  connection,
  card,
  name,
  tokenForm,
  canRun,
  busy,
  pending,
  onConnect,
  onScope,
  onDisconnect,
  onRun,
}: {
  tenantId: string;
  connection: Connection;
  card: Card;
  name: string;
  tokenForm: ReactNode;
  canRun: boolean;
  busy: boolean;
  pending: GrantPending | null;
  onConnect: () => void;
  onScope: () => void;
  onDisconnect: () => void;
  onRun: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const running = connection.lastRun?.status === "running";
  // Two booleans, and `||` is the operator that combines them; Biome's type inference does
  // not see the default on `busy` and asks for `??`, which would be wrong for `false`.
  const cannotRun = [busy, running].includes(true);
  const runIdle = pending === "run" ? t("grant.starting") : t("grant.runNow");
  const runLabel = running ? t("grant.running") : runIdle;

  return (
    <div className="grant__actions">
      {canRun ? (
        <PrimaryAction
          connection={connection}
          card={card}
          name={name}
          tokenForm={tokenForm}
          busy={busy}
          connecting={pending === "connect"}
          onConnect={onConnect}
          onScope={onScope}
        />
      ) : null}

      {/* Run now is a plain plate: the primary action on a granted source is nothing,
          and starting a read by hand is the exception rather than the routine. Disabled
          while a run is in progress, because the ledger would refuse a second one and
          the card already says so. */}
      {card.state === "connected" && canRun ? (
        <button type="button" className="plate" onClick={onRun} disabled={cannotRun}>
          {runLabel}
        </button>
      ) : null}

      {card.state === "connected" && canRun ? (
        <button type="button" className="plate" onClick={onScope} disabled={busy}>
          {t("grant.changeScope")}
        </button>
      ) : null}

      {/* A door, not a write: every role may read the journal, so every role gets it. Only on
          an account that has run, because the list it opens would otherwise be empty. */}
      {connection.lastRun === null ? null : (
        <Link className="plate" to={journalPath(tenantId, { source: connection.source })}>
          {t("grant.openRuns")}
          <ArrowRight size={13} />
        </Link>
      )}

      {/* Last, so the leaf it hinges open unfolds under the row's plates rather than between
          them. */}
      {card.state === "not_connected" || !canRun ? null : (
        <DisconnectFold
          account={connection.externalAccountLabel === "" ? name : connection.externalAccountLabel}
          busy={busy}
          disconnecting={pending === "disconnect"}
          onDisconnect={onDisconnect}
        />
      )}
    </div>
  );
}

/**
 * The state's one primary plate, if it has one: paste a token, go to the consent, or choose
 * what to read. A consent plate keeps saying where it is going until the browser has left.
 */
function PrimaryAction({
  connection,
  card,
  name,
  tokenForm,
  busy,
  connecting,
  onConnect,
  onScope,
}: {
  connection: Connection;
  card: Card;
  name: string;
  tokenForm: ReactNode;
  busy: boolean;
  connecting: boolean;
  onConnect: () => void;
  onScope: () => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const kind = card.action?.kind;
  // A source with no consent screen opens a form in its row instead of sending the browser
  // away; the same plate wording covers a first connection and a reconnect.
  const pastes =
    connectsBy(connection.kind) === "token" && (kind === "connect" || kind === "reconnect");

  if (pastes) {
    return (
      <details className="tokenform">
        <summary className="plate plate--primary">{t("grant.pasteToken")}</summary>
        <div className="hinge">{tokenForm}</div>
      </details>
    );
  }
  if (kind === "scope") {
    return (
      <button type="button" className="plate plate--primary" onClick={onScope} disabled={busy}>
        {t("grant.chooseScope")}
        <ArrowRight size={13} />
      </button>
    );
  }
  if (kind !== "connect" && kind !== "reconnect") {
    return null;
  }
  const idle = kind === "connect" ? t("grant.connect", { name }) : t("grant.reconnect", { name });
  const label = connecting ? t("grant.connecting", { name }) : idle;
  return (
    <button type="button" className="plate plate--primary" onClick={onConnect} disabled={busy}>
      {label}
      <ArrowRight size={13} />
    </button>
  );
}

/**
 * Disconnect, as a second press that names the account. See the file's header. Shut, the fold is
 * one plate in line with the card's others (`.grant__confirm`); only the leaf it opens takes the
 * actions cell's whole width.
 */
function DisconnectFold({
  account,
  busy,
  disconnecting,
  onDisconnect,
}: {
  /** The account's address, or its vendor's name where no address is recorded. */
  account: string;
  busy: boolean;
  /** Whether this card's disconnect is the action in flight. */
  disconnecting: boolean;
  onDisconnect: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <details className="tokenform grant__confirm">
      <summary className="plate">{t("grant.disconnect")}</summary>
      <div className="hinge stack stack--tight">
        <p className="note">{t("grant.disconnectLead")}</p>
        <div className="row">
          <button
            type="button"
            className="plate plate--primary"
            onClick={onDisconnect}
            disabled={busy}
          >
            {disconnecting ? t("grant.disconnecting") : t("grant.disconnectConfirm", { account })}
          </button>
        </div>
      </div>
    </details>
  );
}
