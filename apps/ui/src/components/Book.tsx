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

// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on components that render a handful of rows. The re-render the rule is about matters under a memoised list of hundreds; these lists are bounded by how many connections a tenant has.
// biome-ignore-all lint/style/noJsxLiterals: This would move all 77 pieces of UI copy into constants declared away from the markup that gives them meaning. That trade is worth making when a translation layer needs a key for every string; this app has none, so it buys nothing and costs the ability to read a component and see what it says.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useGlobalThis: Reading `process` in a composition root on Bun, where it is the documented global.
// biome-ignore-all lint/suspicious/noLeakedRender: A boolean guard in JSX whose left side is a real boolean, so nothing leaks.

// biome-ignore-all lint/nursery/noReactNativeRawText: React Native rule: it requires text to sit inside a <Text> component, because RN has no text nodes. This is a web React app rendering to the DOM, where a string inside a <p> is exactly right. On under reactNative: all in biome.jsonc, suppressed where it does not apply.

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

import { type ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";

import { Mark } from "@/components/Mark.tsx";
import { TabRail } from "@/components/TabRail.tsx";
import { applyBoard } from "@/lib/acetate.ts";
import { type DivisionId, division } from "@/lib/divisions.ts";
import { trpc } from "@/trpc.ts";

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
}): React.JSX.Element {
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
      <div className="leaf">
        <div className="leaf__spine" aria-hidden="true">
          <span className="leaf__punch leaf__punch--a" />
          <span className="leaf__punch leaf__punch--b" />
          <span className="leaf__caption">Undercroft · control plane</span>
        </div>

        <header className="runhead">
          <Link className="runhead__mark" to="/tenants">
            <Mark />
            Undercroft
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
            <button
              className="plate plate--small"
              type="button"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              Sign out
            </button>
          </div>
        </header>

        {children}
      </div>

      <TabRail tenantId={tenantId} current={current} />
    </div>
  );
}
