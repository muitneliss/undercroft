/**
 * The book: a leaf lying open on a section board, with the tab rail on the fore
 * edge.
 *
 * This is the whole application chrome, and it is deliberately almost nothing --
 * a running head, a spine, two punch holes and the rail. Everything an operator
 * came to do happens on the leaf.
 *
 * The board hue is solved rather than set. `applyBoard` binary-searches the
 * acetate's alpha against the current division's hue until the reading field
 * clears its contrast target, and publishes the answer as custom properties (see
 * `@/lib/acetate` for why a single hand-picked alpha cannot serve both chrome
 * yellow and ultramarine). It runs on the division, not on every render, because
 * the answer only changes when the section does.
 *
 * The punch holes and the spine caption are the only purely decorative marks in
 * the interface, and so the only ones hidden from assistive technology rather
 * than narrated.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { TabRail } from "@/components/TabRail";
import { applyBoard } from "@/lib/acetate";
import { division, type DivisionId } from "@/lib/divisions";

export function Book({
  tenantId,
  current,
  signedInAs,
  children,
}: {
  tenantId: string | undefined;
  current: DivisionId;
  signedInAs: string;
  children: ReactNode;
}) {
  const board = division(current).hue;

  useEffect(() => {
    applyBoard(document.documentElement, board);
  }, [board]);

  /**
   * Which book is open.
   *
   * A running head exists to answer exactly this, and it has to answer it on
   * every division rather than on one screen: the primary user holds several
   * member companies at once and is usually mid-call about one of them, so a
   * record that never names its customer is a record they have to verify by
   * looking at the URL. Cheap because react-query has almost always cached it
   * from the division underneath.
   */
  const tenant = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () => api.tenant(tenantId ?? ""),
    enabled: Boolean(tenantId),
    retry: false,
  });

  return (
    <div className="book">
      <div className="leaf">
        <div className="leaf__spine" aria-hidden="true">
          <span className="leaf__punch leaf__punch--a" />
          <span className="leaf__punch leaf__punch--b" />
          <span className="leaf__caption">VietCham data platform · control plane</span>
        </div>

        <header className="runhead">
          <Link className="runhead__mark" to="/tenants">
            VietCham Data
          </Link>

          {tenantId ? (
            <span className="runhead__record">
              <span className="runhead__customer">
                {tenant.data ? tenant.data.display_name : tenantId}
              </span>
              <span className="datum datum--quiet">{tenantId}</span>
            </span>
          ) : null}

          <div className="runhead__right">
            <span className="datum datum--quiet">{signedInAs}</span>
            {/* A real form post, not a fetch: signing out revokes the
                server-side session, and the browser must follow the response. */}
            <form method="post" action="/api/auth/logout">
              <button className="plate plate--small" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>

        {children}
      </div>

      <TabRail tenantId={tenantId} current={current} />
    </div>
  );
}
