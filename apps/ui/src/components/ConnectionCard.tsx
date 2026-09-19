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

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Connection } from "@/api/types.ts";
import { SOURCE_ACCESS, SOURCE_LABEL } from "@/api/types.ts";
import { GrantWhen } from "@/components/GrantWhen.tsx";
import { ArrowRight, Errata as ErrataMark } from "@/components/Icon.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import type { Cadence } from "@/lib/cadence.ts";
import { presentConnection, scopeSummary } from "@/lib/connectionState.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { orMissing } from "@/lib/money.ts";
import { expiryNote } from "@/lib/when.ts";

const MARK_LABEL = {
  granted: "grant.markGranted",
  pending: "grant.markPending",
  lapsed: "grant.markLapsed",
  absent: "grant.markAbsent",
} as const;

export function ConnectionCard({
  tenantId,
  connection,
  onConnect,
  onScope,
  onDisconnect,
  onRun,
  onCadence,
  canRun = false,
  busy = false,
}: {
  /** Whose book this row is in: where a failed run's slip links into the journal. */
  tenantId: string;
  connection: Connection;
  onConnect: () => void;
  onScope: () => void;
  onDisconnect: () => void;
  /** Start a run by hand. Only offered when `canRun`. */
  onRun: () => void;
  /** Record how often this source is read. Only offered when `canRun`. */
  onCadence: (cadence: Cadence) => void;
  /** Whether the reader is an admin. Courtesy; the server refuses regardless. */
  canRun?: boolean;
  busy?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const card = presentConnection(t, connection);
  const access = SOURCE_ACCESS[connection.source];
  const name = SOURCE_LABEL[connection.source];
  const headingId = `grant-${connection.source}`;

  const unprinted = card.state === "not_connected";
  const lapsed = card.mark === "lapsed";
  const running = connection.lastRun?.status === "running";
  const failedRun = connection.lastRun?.status === "failed" ? connection.lastRun : null;
  // Two booleans, and `||` is the operator that combines them; Biome's type inference does
  // not see the default on `busy` and asks for `??`, which would be wrong for `false`.
  const cannotRun = [busy, running].includes(true);
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
              <span className="datum datum--quiet">{orMissing(scopeSummary(t, connection))}</span>
            </>
          ) : null}

          {card.state === "needs_scope" ? <p className="note">{card.detail}</p> : null}
        </div>

        <div className="grant__when stack stack--tight">
          {card.state === "connected" ? (
            <GrantWhen connection={connection} canEdit={canRun} busy={busy} onCadence={onCadence} />
          ) : null}

          {/* How long the data has been standing still. A lapse is not an
              instant; six days of it is a different conversation from six
              hours, and the operator is usually on the phone. */}
          {lapsed && connection.expiresAt ? (
            <>
              <span className="label">{t("grant.since")}</span>
              <span className="datum datum--quiet">{expiryNote(t, connection.expiresAt)}</span>
            </>
          ) : null}
        </div>

        <div className="grant__actions">
          {card.action?.kind === "connect" ? (
            <button
              type="button"
              className="plate plate--primary"
              onClick={onConnect}
              disabled={busy}
            >
              {t("grant.connect", { name })}
              <ArrowRight size={13} />
            </button>
          ) : null}

          {card.action?.kind === "scope" ? (
            <button
              type="button"
              className="plate plate--primary"
              onClick={onScope}
              disabled={busy}
            >
              {t("grant.chooseScope")}
              <ArrowRight size={13} />
            </button>
          ) : null}

          {card.action?.kind === "reconnect" ? (
            <button
              type="button"
              className="plate plate--primary"
              onClick={onConnect}
              disabled={busy}
            >
              {t("grant.reconnect", { name })}
              <ArrowRight size={13} />
            </button>
          ) : null}

          {/* Run now is a plain plate: the primary action on a granted source is nothing,
              and starting a read by hand is the exception rather than the routine. Disabled
              while a run is in progress, because the ledger would refuse a second one and
              the card already says so. */}
          {card.state === "connected" && canRun ? (
            <button type="button" className="plate" onClick={onRun} disabled={cannotRun}>
              {running ? t("grant.running") : t("grant.runNow")}
            </button>
          ) : null}

          {card.state === "connected" ? (
            <button type="button" className="plate" onClick={onScope} disabled={busy}>
              {t("grant.changeScope")}
            </button>
          ) : null}

          {unprinted ? null : (
            <button type="button" className="plate" onClick={onDisconnect} disabled={busy}>
              {t("grant.disconnect")}
            </button>
          )}
        </div>
      </div>

      {/* The correction slip. Vermilion is held out of the section wheel for
          exactly this, and a lapsed grant is the state that actually happens in
          production -- so it is the loudest thing in the row, not the quietest. */}
      {lapsed ? (
        <div className="errata errata--inline">
          <span className="errata__mark">
            <ErrataMark size={13} />
            {t("grant.errata")}
          </span>
          <p className="errata__body">{card.detail}</p>
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
          <Link
            className="plate plate--small"
            to={`${divisionPath("journal", tenantId)}/${failedRun.id}`}
          >
            {t("grant.openInJournal")}
          </Link>
        </div>
      ) : null}

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
