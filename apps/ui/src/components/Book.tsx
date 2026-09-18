/**
 * The book: a leaf lying open on a section board, with the tab strip across the
 * head.
 *
 * The strip comes FIRST here, before the leaf, and that is the whole reason the
 * layout is placed by `grid-template-areas` rather than by source order: the
 * phone shows the strip at the foot without moving it in the DOM, so navigation
 * precedes the page it navigates for a keyboard and for a screen reader at every
 * width. Ordering it to match the phone visually would bury the section links
 * behind a long schedule of grants on the surface where that costs most.
 *
 * This is the whole application chrome, and it is deliberately almost nothing --
 * a running head, a spine, two punch holes and the strip. Everything an operator
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

import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Mark } from "@/components/Mark";
import { TabRail } from "@/components/TabRail";
import { applyBoard } from "@/lib/acetate";
import { division, type DivisionId } from "@/lib/divisions";
import { trpc } from "@/trpc";

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
  const { t } = useTranslation();
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
  const tenant = trpc.tenants.get.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: Boolean(tenantId), retry: false },
  );

  const signOut = trpc.session.signOut.useMutation({
    onSuccess: () => {
      // The opaque session is revoked server-side; a full reload drops back to the title
      // page rather than leaving a stale cache pointed at a dead session.
      window.location.assign("/");
    },
  });

  return (
    <div className="book">
      <TabRail tenantId={tenantId} current={current} />

      <div className="leaf">
        <div className="leaf__spine" aria-hidden="true">
          <span className="leaf__punch leaf__punch--a" />
          <span className="leaf__punch leaf__punch--b" />
          <span className="leaf__caption">{t("app.caption")}</span>
        </div>

        <header className="runhead">
          <Link className="runhead__mark" to="/tenants">
            <Mark />
            {t("app.name")}
          </Link>

          {tenantId ? (
            <span className="runhead__record">
              <span className="runhead__customer">
                {tenant.data ? tenant.data.displayName : tenantId}
              </span>
              <span className="datum datum--quiet">{tenantId}</span>
            </span>
          ) : null}

          <div className="runhead__right">
            <span className="datum datum--quiet">{signedInAs}</span>
            {/* Beside the sign-out plate, not buried in a settings page: changing language
                is something a reader does in their first seconds, before they know where
                anything else is. */}
            <LanguageSwitcher />
            <button
              className="plate plate--small"
              type="button"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              {t("app.signOut")}
            </button>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
