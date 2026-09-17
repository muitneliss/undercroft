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
 */

import type { Connection } from "@/api/types";
import { SOURCE_ACCESS, SOURCE_LABEL } from "@/api/types";
import { ArrowRight, Errata as ErrataMark } from "@/components/Icon";
import { StatusMark } from "@/components/StatusMark";
import { presentConnection, scopeSummary } from "@/lib/connectionState";
import { orMissing } from "@/lib/money";
import { describeSchedule, expiryNote } from "@/lib/when";

const MARK_LABEL = {
  granted: "Granted",
  pending: "Awaiting scope",
  lapsed: "Reconnect needed",
  absent: "Not granted",
} as const;

export function ConnectionCard({
  connection,
  onConnect,
  onScope,
  onDisconnect,
  busy = false,
}: {
  connection: Connection;
  onConnect: () => void;
  onScope: () => void;
  onDisconnect: () => void;
  busy?: boolean;
}) {
  const card = presentConnection(connection);
  const access = SOURCE_ACCESS[connection.source];
  const name = SOURCE_LABEL[connection.source];
  const headingId = `grant-${connection.source}`;

  const unprinted = card.state === "not_connected";
  const lapsed = card.mark === "lapsed";
  const named = connection.external_account_label !== "";

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
          <StatusMark mark={card.mark} label={MARK_LABEL[card.mark]} />
        </div>

        <div className="grant__account stack stack--tight">
          {/* Named for a lapsed grant too, not only a healthy one: the first
              thing an operator needs to know about a withdrawn grant is which
              account withdrew it, and "Reconnect Xero" alone does not say. */}
          {named && card.state !== "needs_scope" ? (
            <>
              <span className="label">Account</span>
              <span className="datum">{orMissing(connection.external_account_label)}</span>
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
              <span className="label">Reads</span>
              <span className="datum datum--quiet">{orMissing(scopeSummary(connection))}</span>
            </>
          ) : null}

          {card.state === "needs_scope" ? <p className="note">{card.detail}</p> : null}
        </div>

        <div className="grant__when stack stack--tight">
          {card.state === "connected" ? (
            <>
              <span className="label">Schedule</span>
              <span className="datum datum--quiet">
                {connection.schedule_cron
                  ? describeSchedule(connection.schedule_cron)
                  : orMissing("")}
              </span>
              <span className="datum datum--quiet">{expiryNote(connection.expires_at)}</span>
            </>
          ) : null}

          {/* How long the data has been standing still. A lapse is not an
              instant; six days of it is a different conversation from six
              hours, and the operator is usually on the phone. */}
          {lapsed && connection.expires_at ? (
            <>
              <span className="label">Since</span>
              <span className="datum datum--quiet">{expiryNote(connection.expires_at)}</span>
            </>
          ) : null}
        </div>

        <div className="grant__actions">
          {card.action?.kind === "connect" ? (
            <button className="plate plate--primary" onClick={onConnect} disabled={busy}>
              Connect {name}
              <ArrowRight size={13} />
            </button>
          ) : null}

          {card.action?.kind === "scope" ? (
            <button className="plate plate--primary" onClick={onScope} disabled={busy}>
              Choose what to sync
              <ArrowRight size={13} />
            </button>
          ) : null}

          {card.action?.kind === "reconnect" ? (
            <button className="plate plate--primary" onClick={onConnect} disabled={busy}>
              Reconnect {name}
              <ArrowRight size={13} />
            </button>
          ) : null}

          {card.state === "connected" ? (
            <button className="plate" onClick={onScope} disabled={busy}>
              Change what syncs
            </button>
          ) : null}

          {!unprinted ? (
            <button className="plate" onClick={onDisconnect} disabled={busy}>
              Disconnect
            </button>
          ) : null}
        </div>
      </div>

      {/* The correction slip. Vermilion is held out of the section wheel for
          exactly this, and a lapsed grant is the state that actually happens in
          production -- so it is the loudest thing in the row, not the quietest. */}
      {lapsed ? (
        <div className="errata errata--inline">
          <span className="errata__mark">
            <ErrataMark size={13} />
            Errata
          </span>
          <p className="errata__body">{card.detail}</p>
        </div>
      ) : null}

      {/* Stated before the redirect, never after it. Dropped once the decision
          has been made, because repeating it then is noise. */}
      {unprinted ? (
        <dl className="access">
          <dt>What we read</dt>
          <dd>{access.reads}</dd>
          <dt>What we change</dt>
          <dd>{access.writes}</dd>
        </dl>
      ) : null}
    </article>
  );
}
