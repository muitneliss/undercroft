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
 */

export type Verdict = "ok" | "mismatch" | "unverified";

export type VerdictPresentation = {
  label: string;
  /** Screen-reader text: the badge must not rely on colour alone (WCAG AA). */
  description: string;
  tone: "positive" | "negative" | "neutral";
  icon: string;
};

export function presentVerdict(verdict: Verdict): VerdictPresentation {
  switch (verdict) {
    case "ok":
      return {
        label: "Reconciled",
        description: "Checked against the source and matching.",
        tone: "positive",
        icon: "check",
      };
    case "mismatch":
      return {
        label: "Mismatch",
        description: "Checked against the source and disagreeing.",
        tone: "negative",
        icon: "alert",
      };
    case "unverified":
      return {
        // Deliberately not "Pending" or "Unknown": both suggest a state that
        // will resolve itself. It will not. There was nothing to compare
        // against, and that is the finding.
        label: "Not verified",
        description: "No evidence either way. Absence of a mismatch is not a match.",
        tone: "neutral",
        icon: "circle",
      };
    default: {
      const exhaustive: never = verdict;
      throw new Error(`unhandled verdict ${String(exhaustive)}`);
    }
  }
}
