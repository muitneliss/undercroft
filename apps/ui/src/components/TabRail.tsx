/**
 * The tab strip: this application's entire navigation.
 *
 * In a tabbed reference manual the divisions are cut into the board, sized in
 * proportion to how much of the book each one occupies -- so the strip is a
 * picture of the book as well as a control. Putting the navigation in a tab
 * strip rather than a left sidebar is the single most consequential decision in
 * this design, and it is the form's, not a preference: a sidebar would make this
 * a dashboard wearing a manual's colours.
 *
 * These are TOP tabs, across the head. They were side tabs down the fore edge
 * until a 3.25rem edge proved it could only carry a word by turning it on its
 * side, and a rotated word leaves the eye no shape to catch -- on the one
 * control whose whole job is answering which section is open. The top tab is the
 * other real divider form, and the one whose lettering was always printed
 * upright. ADR 0012 records the change and the alternatives rejected with it.
 *
 * `extent` therefore drives WIDTH rather than height. It is still a property of
 * the division and not a count of the current customer's rows (see
 * `@/lib/divisions`), so the navigation never resizes under the cursor.
 *
 * FACE-DOWN, NOT HIDDEN. Six of the seven divisions are sections of one
 * customer's book and cannot be opened until a customer is chosen. They render
 * face-down -- the leaf turned over, showing unprinted board back -- rather than
 * disappearing, because a division that vanishes teaches nobody that it exists,
 * and an operator who has never seen the People tab does not know to look for
 * it. `aria-disabled` with the reason in the accessible name says the same thing
 * to someone who cannot see the turned-over leaf.
 *
 * The form says the divider boards "carry no mark at all". These carry their
 * labels. This is an Operate surface and unlabelled navigation is not a
 * stylistic position, it is a defect; it is the only place this build departs
 * from the form.
 */

// A plain Link, deliberately not a NavLink. NavLink decides "active" by path
// prefix, so `/tenants` stayed active inside `/tenants/CASE-.../lake` and two
// tabs rendered as the current one -- two punched holes in a strip whose whole
// job is saying which section you are in. The division is already known here.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { letteringOn } from "@/lib/acetate.ts";
import { DIVISIONS, type DivisionId, divisionPath } from "@/lib/divisions.ts";

/** The phone layout's breakpoint, where the strip sits at the foot and scrolls sideways. */
const FOOT_STRIP = "(max-width: 760px)";

export function TabRail({
  tenantId,
  current,
}: {
  tenantId: string | undefined;
  current: DivisionId;
}): React.JSX.Element {
  const { t } = useTranslation();
  const railRef = useRef<HTMLElement>(null);

  /**
   * On a phone the strip is wider than the screen, and a division past its edge would open
   * with no tab in view saying which it is. So the current tab is brought into view whenever
   * it changes -- and whenever the screen narrows past the breakpoint, since a window made
   * narrow (or a tablet turned) moves the strip to the foot with its first tabs showing, and a
   * page opened wide and then narrowed would otherwise never say where it is.
   *
   * Only below the breakpoint: on a wide screen every tab is already in view. At once rather
   * than smoothly, because every other movement in the book is stepped (ADR 0014) and a smooth
   * scroll is an easing curve by another name. A ref, not state: it is the DOM node.
   *
   * The STRIP scrolls, sideways, and nothing else. `scrollIntoView` also scrolls every
   * ancestor, the window included, to fit the raised current tab of the sticky strip -- so
   * opening a division nudged the whole page a few pixels up, and a capture of it moved with it.
   */
  useEffect(() => {
    const strip = globalThis.matchMedia(FOOT_STRIP);
    function reveal(): void {
      const rail = railRef.current;
      const tab = rail?.querySelector(`[data-division="${current}"]`);
      if (!strip.matches || rail === null || tab === null || tab === undefined) {
        return;
      }
      const offset = tab.getBoundingClientRect().left - rail.getBoundingClientRect().left;
      const centred = offset - (rail.clientWidth - tab.getBoundingClientRect().width) / 2;
      rail.scrollTo({ left: rail.scrollLeft + centred });
    }
    reveal();
    strip.addEventListener("change", reveal);
    return (): void => {
      strip.removeEventListener("change", reveal);
    };
  }, [current]);

  return (
    <nav className="rail" aria-label={t("nav.sections")} ref={railRef}>
      {DIVISIONS.map((div) => {
        const locked = div.scoped && !tenantId;
        // Lettering is chosen per hue rather than fixed: white reads at 2.09:1
        // on the chrome board and 7.6:1 on the ultramarine one.
        const style = {
          flexGrow: div.extent,
          background: div.hue,
          color: letteringOn(div.hue),
        } as const;

        if (locked) {
          return (
            <span
              key={div.id}
              className="rail__tab"
              aria-disabled="true"
              style={{ flexGrow: div.extent }}
              title={t("nav.lockedTitle")}
            >
              {t(div.labelKey)}
              <span className="visually-hidden">{t("nav.lockedHint")}</span>
            </span>
          );
        }

        return (
          <Link
            key={div.id}
            className="rail__tab"
            style={style}
            to={divisionPath(div.id, tenantId)}
            data-division={div.id}
            {...(div.id === current ? { "aria-current": "page" as const } : {})}
          >
            {t(div.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
