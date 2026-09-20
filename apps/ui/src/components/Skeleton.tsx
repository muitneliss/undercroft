/**
 * Lines of type being set, where the content is about to be.
 *
 * A spinner in the middle of a leaf says "something is happening"; a set line
 * says what is about to be there, which keeps the leaf from jumping when it
 * lands and gives the eye somewhere to be. `aria-busy` carries the same fact to
 * a screen reader, which cannot see either.
 *
 * The lines are ragged on purpose -- text sets ragged, and a stack of identical
 * full-width bars is the one shape real content never has.
 */

import { useTranslation } from "react-i18next";

import { Skeleton as SkeletonLine } from "@/components/ui/skeleton.tsx";

export function Skeleton({ rows = 3 }: { rows?: number }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{t("common.loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonLine key={i} style={{ width: `${String(94 - ((i * 13) % 38))}%` }} />
      ))}
    </div>
  );
}
