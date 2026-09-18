/**
 * A printed status mark: geometry, then word, then hue.
 *
 * WCAG 2.1 AA 1.4.1 says colour must not be the only means of conveying
 * information. This goes further than satisfying it, because the form does the
 * work: the four states are four different SHAPES from `@/components/Icon` --
 * solid, half, struck, open -- so the state survives a greyscale screenshot
 * pasted into a runbook, a colour-blind operator, and a badly calibrated
 * monitor. The word is the second carrier; the hue is the third and least
 * load-bearing.
 *
 * The mark itself is `aria-hidden`, because the word beside it is already the
 * accessible name.
 *
 * It carries no hidden description. Every state's explanation is already visible
 * on its row -- in the errata slip, the account column or the schedule column --
 * and repeating it here read the same sentence to a screen reader twice while
 * showing it to everyone else once.
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

import { MarkAbsent, MarkGranted, MarkLapsed, MarkPending } from "@/components/Icon.tsx";
import type { CardPresentation } from "@/lib/connectionState.ts";

type Mark = CardPresentation["mark"];

const GLYPH: Record<Mark, typeof MarkGranted> = {
  granted: MarkGranted,
  pending: MarkPending,
  lapsed: MarkLapsed,
  absent: MarkAbsent,
};

export function StatusMark({ mark, label }: { mark: Mark; label: string }): React.JSX.Element {
  const Glyph = GLYPH[mark];

  return (
    <span className={`mark mark--${mark}`}>
      <Glyph size={13} />
      {label}
    </span>
  );
}
