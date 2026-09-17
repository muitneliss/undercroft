/**
 * One source on the setup checklist.
 *
 * The design problem here is not layout, it is trust. A client admin is being
 * asked to hand over access to their company email and their accounting system,
 * and a button reading "Connect Gmail" with no statement of what that means is
 * not consent. So what will be read, what will never be written, and the fact
 * that it can be disconnected are stated on the card itself, before the
 * redirect — not on a help page nobody opens.
 *
 * Every state has its own copy and its own single next action. See
 * `@/lib/connectionState` for why `needs_scope` and `needs_reconnect` are
 * separate states rather than two shades of "not working".
 */

import type { Connection } from "@/api/types";
import { SOURCE_ACCESS, SOURCE_LABEL } from "@/api/types";
import { StatusBadge } from "@/components/StatusBadge";
import { presentConnection } from "@/lib/connectionState";

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

  return (
    <article className="card stack" aria-labelledby={`conn-${connection.source}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 id={`conn-${connection.source}`} className="card__title">
          {name}
        </h3>
        <StatusBadge tone={card.tone} label={card.headline} />
      </div>

      {card.detail ? <p className="card__detail">{card.detail}</p> : null}

      {card.state === "not_connected" ? (
        <dl className="access-note">
          <dt>What we read</dt>
          <dd>{access.reads}</dd>
          <dt>What we change</dt>
          <dd>{access.writes}</dd>
        </dl>
      ) : null}

      <div className="row">
        {card.action?.kind === "connect" ? (
          <button className="btn btn--primary" onClick={onConnect} disabled={busy}>
            Connect {name}
          </button>
        ) : null}

        {card.action?.kind === "scope" ? (
          <button className="btn btn--primary" onClick={onScope} disabled={busy}>
            Choose what to sync
          </button>
        ) : null}

        {card.action?.kind === "reconnect" ? (
          <button className="btn btn--primary" onClick={onConnect} disabled={busy}>
            Reconnect {name}
          </button>
        ) : null}

        {card.state === "connected" ? (
          <button className="btn" onClick={onScope} disabled={busy}>
            Change what syncs
          </button>
        ) : null}

        {card.state !== "not_connected" ? (
          <button className="btn btn--danger" onClick={onDisconnect} disabled={busy}>
            Disconnect
          </button>
        ) : null}
      </div>
    </article>
  );
}
