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

import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Colophon } from "@/components/Colophon.tsx";
import { LanguageSwitcher } from "@/components/LanguageSwitcher.tsx";
import { Mark } from "@/components/Mark.tsx";
import { TabRail } from "@/components/TabRail.tsx";
import { applyBoard } from "@/lib/acetate.ts";
import { type DivisionId, division } from "@/lib/divisions.ts";
import { trpc } from "@/trpc.ts";

export function Book({
  tenantId,
  current,
  signedInAs,
  fill = false,
  children,
}: {
  tenantId: string | undefined;
  current: DivisionId;
  signedInAs: string;
  /**
   * Bind the leaf to the window rather than to its own content.
   *
   * Every page in this book is as tall as what is printed on it, and the window scrolls past
   * it. One is not: a workbench divides a screenful between a query and its answer, and it
   * can only divide a height it knows. So the book takes the viewport exactly, the leaf stops
   * scrolling, and the page inside it is handed a definite height to divide.
   *
   * The strip, the spine and the running head stay. An operator holding four customers' books
   * at once must never be one press from running a query against the wrong one, and a
   * full-screen console with no running head is exactly that.
   */
  fill?: boolean;
  children: ReactNode;
}): React.JSX.Element {
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
      globalThis.location.assign("/");
    },
  });

  return (
    <div className={fill ? "book book--fill" : "book"}>
      <TabRail tenantId={tenantId} current={current} />

      {/*
        Keyed to WHICH BOOK IS OPEN AT WHICH DIVISION, which is the same thing as
        "is this a different page". React Router reconciles two routes that render
        the same component in the same position -- every division here goes through
        `Opened` -- so without a key the leaf is updated rather than remounted and
        the page turn in `index.css` never fires.

        The key is the pair rather than the division alone because switching
        customers inside one section is a different book, and a different book has
        to turn. It deliberately does NOT carry the rest of the path: a scope panel
        hinging open inside the section it already belongs to is the same leaf, and
        a leaf that turns to show a panel on the page you were already reading is
        motion lying about what happened.
      */}
      <div className={fill ? "leaf leaf--fill" : "leaf"} key={`${tenantId ?? ""}/${current}`}>
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
              onClick={(): void => signOut.mutate()}
              disabled={signOut.isPending}
            >
              {t("app.signOut")}
            </button>
          </div>
        </header>

        {children}

        {/* Last on the leaf, and last in the DOM: the page is what the reader came for,
            and the printing it came from is the footnote to it. */}
        <Colophon />
      </div>
    </div>
  );
}
