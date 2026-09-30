/**
 * One source's standing grant, as a row on the schedule.
 *
 * The design problem here is not layout, it is trust. A client admin is being
 * asked to hand over access to their company email and their accounting system,
 * and a button reading "Connect Gmail" with no statement of what that means is
 * not consent. So what will be read, what will never be written, and the fact
 * that it can be disconnected are stated on the leaf itself, before the
 * redirect -- not on a help page nobody opens. `ConnectionCard.test.tsx` pins
 * that copy; if a later pass deletes it as clutter, those tests are the
 * objection.
 *
 * WHY A ROW AND NOT A CARD. Four equal cards in a grid give a lapsed grant
 * exactly the same footprint as a healthy one, which is the single thing this
 * screen exists to prevent. As a schedule, each state gets the height it
 * deserves: a granted source is one line, a source awaiting its scope is
 * half-hinged off its binding edge, a source nobody has granted yet is an
 * unprinted leaf carrying the whole access statement because that is the
 * decision being asked for, and a lapsed grant tips in an errata slip.
 *
 * Every state has its own copy and its own single next action. See
 * `@/lib/connectionState` for why `needs_scope` and `needs_reconnect` are
 * separate states rather than two shades of "not working".
 *
 * A card is ONE account (ADR 0043). What the connection is -- `connection.kind` -- decides its
 * name and its access statement; which one it is -- `connection.source` -- decides its heading
 * id, so two mailboxes' cards could never share one. It is also the door to that account's runs:
 * the journal, filtered to this source (ADR 0091).
 *
 * WRITE PLATES ARE ABSENT, NOT DISABLED, FOR A READER THE SERVER REFUSES THEM TO. Connect,
 * Reconnect, the token form, Choose what to sync, Change what syncs and Disconnect are an
 * admin's, like Run now; a member or viewer used to see all of them greyed out, which is a
 * promise the leaf cannot keep drawn as a control nobody here may press. `canRun` is the one
 * question, asked once in `GrantActions`. Hiding is courtesy; the server refuses regardless.
 *
 * The plates themselves, Disconnect's second press among them, are `GrantActions`.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Connection } from "@/api/types.ts";
import { SOURCE_ACCESS, SOURCE_LABEL } from "@/api/types.ts";
import { GrantActions, type GrantPending } from "@/components/GrantActions.tsx";
import { GrantWhen } from "@/components/GrantWhen.tsx";
import { Errata as ErrataMark } from "@/components/Icon.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import type { CadenceChoice } from "@/lib/cadence.ts";
import {
  type CardPresentation,
  MARK_LABEL,
  presentConnection,
  scopeSummary,
  ungrantedNotes,
} from "@/lib/connectionState.ts";
import { orMissing } from "@/lib/money.ts";
import { journalPath } from "@/lib/runs.ts";
import { expiryNote } from "@/lib/when.ts";

export function ConnectionCard({
  tenantId,
  connection,
  onConnect,
  onScope,
  onDisconnect,
  onRun,
  onCadence,
  onResync,
  canRun = false,
  busy = false,
  pending = null,
  oneOfSeveral = false,
  tokenForm,
}: {
  /** Whose book this row is in: where a failed run's slip links into the journal. */
  tenantId: string;
  connection: Connection;
  /**
   * Whether the card's kind holds more than one account, so the card names WHICH by its source
   * under the mark. One account of a kind needs no second name beside its vendor's.
   */
  oneOfSeveral?: boolean;
  onConnect: () => void;
  onScope: () => void;
  onDisconnect: () => void;
  /** Start a run by hand. Only offered when `canRun`. */
  onRun: () => void;
  /** Record how often this source is read. Only offered when `canRun`. */
  onCadence: (choice: CadenceChoice) => void;
  /** Record how often this source's lists are re-read in full. Only offered when `canRun`. */
  onResync: (choice: CadenceChoice) => void;
  /** Whether the reader is an admin. Courtesy; the server refuses regardless. */
  canRun?: boolean;
  busy?: boolean;
  /** This card's action in flight, if any; see `GrantPending`. */
  pending?: GrantPending | null;
  /**
   * The form a token-connected source opens in its row. A slot rather than a component the
   * card renders itself, so the card stays renderable with no tRPC provider behind it.
   */
  tokenForm?: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const card = presentConnection(t, connection);
  const access = SOURCE_ACCESS[connection.kind];
  const name = SOURCE_LABEL[connection.kind];
  const headingId = `grant-${connection.source}`;

  const unprinted = card.state === "not_connected";
  const lapsed = card.mark === "lapsed";
  const failedRun = connection.lastRun?.status === "failed" ? connection.lastRun : null;
  const named = connection.externalAccountLabel !== "";

  const className = [
    "grant",
    unprinted ? "grant--unprinted" : "",
    card.state === "needs_scope" ? "grant--pending" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className} aria-labelledby={headingId}>
      <div className="grant__head">
        <div className="stack stack--tight">
          {/* The accessible name is the source and nothing else: the status is
              its own element, so a heading never reads as "Xero, lapsed". */}
          <h3 id={headingId} className="grant__name">
            {name}
          </h3>
          <StatusMark mark={card.mark} label={t(MARK_LABEL[card.mark])} />
          {oneOfSeveral ? <span className="datum datum--quiet">{connection.source}</span> : null}
        </div>

        <div className="grant__account stack stack--tight">
          {/* Named for a lapsed grant too, not only a healthy one: the first
              thing an operator needs to know about a withdrawn grant is which
              account withdrew it, and "Reconnect Xero" alone does not say. */}
          {named && card.state !== "needs_scope" ? (
            <>
              <span className="label">{t("grant.account")}</span>
              <span className="datum">{orMissing(connection.externalAccountLabel)}</span>
            </>
          ) : null}

          {/* What this grant permits, for the years after it was made. The
              access statement answers it before the redirect; nothing answered
              it afterwards, which left the schedule saying who and when but
              never over what. Deliberately not the words "what we read" -- that
              phrasing belongs to the pre-consent statement and repeating it on a
              live grant would read as though consent were being asked again. */}
          {card.state === "connected" ? (
            <>
              <span className="label">{t("grant.reads")}</span>
              <span className="datum datum--quiet">
                {orMissing(scopeSummary(t, connection.kind, connection.config))}
              </span>
            </>
          ) : null}

          {card.state === "needs_scope" ? <p className="note">{card.detail}</p> : null}

          {card.state === "connected" ? <GrantGaps connection={connection} /> : null}
        </div>

        <GrantTiming
          tenantId={tenantId}
          connection={connection}
          card={card}
          canRun={canRun}
          busy={busy}
          pending={pending}
          onCadence={onCadence}
          onResync={onResync}
        />

        <GrantActions
          tenantId={tenantId}
          connection={connection}
          card={card}
          name={name}
          tokenForm={tokenForm}
          canRun={canRun}
          busy={busy}
          pending={pending}
          onConnect={onConnect}
          onScope={onScope}
          onDisconnect={onDisconnect}
          onRun={onRun}
        />
      </div>

      <GrantSlips tenantId={tenantId} lapsed={lapsed} detail={card.detail} failedRun={failedRun} />

      {/* Stated before the redirect, never after it. Dropped once the decision
          has been made, because repeating it then is noise. */}
      {unprinted ? (
        <dl className="access">
          <dt>{t("grant.whatWeRead")}</dt>
          <dd>{t(access.reads)}</dd>
          <dt>{t("grant.whatWeChange")}</dt>
          <dd>{t(access.writes)}</dd>
        </dl>
      ) : null}
    </article>
  );
}

/**
 * What a runnable grant does not reach, beside what it reads.
 *
 * A grant that lacks the permission some chosen lists are read under still runs and reads the
 * rest, and a run skips exactly these lists (ADR 0073). So the row says which, and its one
 * primary plate is the reconnect that grants them (ADR 0074). Nothing for a whole grant.
 */
function GrantGaps({ connection }: { connection: Connection }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      {ungrantedNotes(t, connection).map((note) => (
        <p key={note} className="note">
          {note}
        </p>
      ))}
    </>
  );
}

/** What `presentConnection` decided this row says and offers. */
type Card = CardPresentation;

/**
 * When the grant runs, or since when it has lapsed: the row's third column.
 *
 * The cadence select is only on a granted source, and says so while a change to it is saved.
 */
function GrantTiming({
  tenantId,
  connection,
  card,
  canRun,
  busy,
  pending,
  onCadence,
  onResync,
}: {
  tenantId: string;
  connection: Connection;
  card: Card;
  canRun: boolean;
  busy: boolean;
  pending: GrantPending | null;
  onCadence: (choice: CadenceChoice) => void;
  onResync: (choice: CadenceChoice) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="grant__when stack stack--tight">
      {card.state === "connected" ? (
        <GrantWhen
          tenantId={tenantId}
          connection={connection}
          canEdit={canRun}
          busy={busy}
          saving={pending === "cadence"}
          onCadence={onCadence}
          resyncSaving={pending === "resync"}
          onResync={onResync}
        />
      ) : null}

      {/* How long the data has been standing still. A lapse is not an
          instant; six days of it is a different conversation from six
          hours, and the operator is usually on the phone. */}
      {card.mark === "lapsed" && connection.expiresAt ? (
        <>
          <span className="label">{t("grant.since")}</span>
          <span className="datum datum--quiet">{expiryNote(t, connection.expiresAt)}</span>
        </>
      ) : null}
    </div>
  );
}

/**
 * The correction slips: the grant itself, or the last run.
 *
 * At most one shows. A lapsed grant is the louder fact -- a failed run under a withdrawn
 * grant is a consequence of it, and two slips would have the operator chasing the symptom.
 */
function GrantSlips({
  tenantId,
  lapsed,
  detail,
  failedRun,
}: {
  tenantId: string;
  lapsed: boolean;
  detail: Card["detail"];
  failedRun: { id: string; error: string | null } | null;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      {/* Vermilion is held out of the section wheel for exactly this, and a lapsed grant is
          the state that actually happens in production -- so it is the loudest thing in the
          row, not the quietest. */}
      {lapsed ? (
        <div className="errata errata--inline">
          <span className="errata__mark">
            <ErrataMark size={13} />
            {t("grant.errata")}
          </span>
          <p className="errata__body">{detail}</p>
        </div>
      ) : null}

      {/* A failed run gets the same slip, with the run's own reason. The grant may be fine;
          what is wrong is the record, and the card must not read "granted, syncing" over a
          source that stopped landing anything last night. */}
      {!lapsed && failedRun !== null ? (
        <div className="errata errata--inline">
          <span className="errata__mark">
            <ErrataMark size={13} />
            {t("grant.runFailedHead")}
          </span>
          <p className="errata__body">{orMissing(failedRun.error)}</p>
          <Link className="plate plate--small" to={journalPath(tenantId, { runId: failedRun.id })}>
            {t("grant.openInJournal")}
          </Link>
        </div>
      ) : null}
    </>
  );
}
