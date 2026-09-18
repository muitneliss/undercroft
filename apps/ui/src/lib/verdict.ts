/**
 * The three-valued comparison, kept three-valued in the interface.
 *
 * `.claude/rules/data-integrity.md`: comparison is `ok` / `mismatch` /
 * `unverified`, and **`unverified` must not be collapsed into either of the
 * other two to make a caller's branching simpler**. A UI is a caller. Rendering
 * it as a muted "ok" says we checked and it passed; rendering it as a warning
 * says we checked and it failed. Neither happened.
 *
 * The exhaustive switch with a `never` default is what makes a fourth state a
 * compile error rather than a blank badge.
 *
 * The words come from the catalogue the caller hands in, the same arrangement
 * `@/lib/connectionState` uses. "Not verified" in particular must translate as
 * carefully as it was worded: `unverifiedLabel` has to keep saying that nothing
 * was checked, not that a check is pending.
 */

import type { TFunction } from "i18next";

export type Verdict = "ok" | "mismatch" | "unverified";

export interface VerdictPresentation {
  label: string;
  /** Screen-reader text: the badge must not rely on colour alone (WCAG AA). */
  description: string;
  tone: "positive" | "negative" | "neutral";
  icon: string;
}

export function presentVerdict(t: TFunction, verdict: Verdict): VerdictPresentation {
  switch (verdict) {
    case "ok":
      return {
        label: t("verdict.okLabel"),
        description: t("verdict.okDescription"),
        tone: "positive",
        icon: "check",
      };
    case "mismatch":
      return {
        label: t("verdict.mismatchLabel"),
        description: t("verdict.mismatchDescription"),
        tone: "negative",
        icon: "alert",
      };
    case "unverified":
      return {
        // Deliberately not "Pending" or "Unknown": both suggest a state that
        // will resolve itself. It will not. There was nothing to compare
        // against, and that is the finding. Both catalogues are held to that.
        label: t("verdict.unverifiedLabel"),
        description: t("verdict.unverifiedDescription"),
        tone: "neutral",
        icon: "circle",
      };
    default: {
      const exhaustive: never = verdict;
      throw new Error(`unhandled verdict ${String(exhaustive)}`);
    }
  }
}
