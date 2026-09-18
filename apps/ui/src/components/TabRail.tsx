/**
 * The fore-edge tab rail: this application's entire navigation.
 *
 * In a tabbed reference manual the divisions are on the fore edge, and their tab
 * heights are proportional to how much of the book each one occupies -- so the
 * rail is a picture of the book as well as a control. Putting the navigation
 * there rather than in a left sidebar is the single most consequential decision
 * in this design, and it is the form's, not a preference: a sidebar would make
 * this a dashboard wearing a manual's colours.
 *
 * FACE-DOWN, NOT HIDDEN. Three of the four divisions are sections of one
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

// biome-ignore-all lint/nursery/noInlineStyles: Every one of these is data becoming a style: the tab rail's flexGrow IS the division's extent, the skeleton's width varies per row, the colour wheel paints each swatch its own hue. Biome's fix deletes the attribute rather than relocating it, which removes the feature.
// biome-ignore-all lint/style/noJsxLiterals: This would move all 77 pieces of UI copy into constants declared away from the markup that gives them meaning. That trade is worth making when a translation layer needs a key for every string; this app has none, so it buys nothing and costs the ability to read a component and see what it says.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

// biome-ignore-all lint/nursery/noReactNativeRawText: React Native rule: it requires text to sit inside a <Text> component, because RN has no text nodes. This is a web React app rendering to the DOM, where a string inside a <p> is exactly right. On under reactNative: all in biome.jsonc, suppressed where it does not apply.

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

// A plain Link, deliberately not a NavLink. NavLink decides "active" by path
// prefix, so `/tenants` stayed active inside `/tenants/CASE-.../lake` and two
// tabs rendered as the current one -- two punched holes in a rail whose whole
// job is saying which section you are in. The division is already known here.
import { Link } from "react-router-dom";

import { letteringOn } from "@/lib/acetate.ts";
import { DIVISIONS, type DivisionId, divisionPath } from "@/lib/divisions.ts";

export function TabRail({
  tenantId,
  current,
}: {
  tenantId: string | undefined;
  current: DivisionId;
}): React.JSX.Element {
  return (
    <nav className="rail" aria-label="Sections">
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
              title="Choose a customer first"
            >
              {div.label}
              <span className="visually-hidden"> — choose a customer first</span>
            </span>
          );
        }

        return (
          <Link
            key={div.id}
            className="rail__tab"
            style={style}
            to={divisionPath(div.id, tenantId)}
            {...(div.id === current ? { "aria-current": "page" as const } : {})}
          >
            {div.label}
          </Link>
        );
      })}
    </nav>
  );
}
