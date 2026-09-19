/**
 * Which labels the scope picker shows, in which runs, and in what order.
 *
 * Wordless, the way `connectionFacts` is wordless beside `presentConnection`: this decides
 * the SHAPE of the index and the component names the runs out of the catalogue it holds.
 * That split is what lets the ordering and the matching be proven without rendering a tRPC
 * provider, and it is what keeps a Vietnamese and an English reader looking at the same
 * index rather than two differently-sorted ones.
 *
 * ## An admin's own labels come first
 *
 * Gmail returns the thirteen it ships -- INBOX, SENT, TRASH, the CATEGORY_* group -- and
 * then whatever somebody made, in no order anyone chose. On a real mailbox that buries the
 * five labels an admin came to this screen to find under thirteen they did not. So the runs
 * are ordered by who owns them, and within a run by name.
 *
 * A label Gmail declined to classify gets its OWN run. Filing it under "yours" would be a
 * statement about who made it, invented here, on the screen where a customer's data custody
 * is decided. Three-valued in, three runs out.
 *
 * ## Matching folds diacritics
 *
 * The operators read Vietnamese and frequently type it on a keyboard that is not set to
 * Vietnamese. A filter that answers `nhan` with nothing while `Nhãn` sits two rows below is
 * a filter that looks broken, and the reader's conclusion is that the list is wrong rather
 * than that their keyboard is. Both sides are folded through the same function, so the fold
 * cannot drift between what is typed and what is searched.
 */

// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses.

/** Who owns a label, as the provider reported it. Null is "it did not say". */
export type LabelOwner = "system" | "user" | null;

/** One label as the picker receives it over the wire. */
export interface BrowsedLabel {
  readonly id: string;
  readonly name: string;
  readonly kind: LabelOwner;
}

/** One headed run of the index. Runs with nothing in them are not produced. */
export interface LabelRun {
  readonly kind: LabelOwner;
  readonly items: BrowsedLabel[];
}

/** Yours, then the unclassified, then Gmail's own. The reason is in the docstring above. */
const RUN_ORDER: readonly LabelOwner[] = ["user", null, "system"];

/** Hoisted because a `/g` literal rebuilt per call is a lint rule and a wasted compile. */
const DIACRITIC = /\p{Diacritic}/gu;

/**
 * Đ is a STROKE, not an accent, and NFD does not take it off.
 *
 * `Nhãn` decomposes to `n` plus a combining tilde and the tilde falls away with everything
 * else. `Đơn hàng` does not: U+0110 is its own letter in Unicode, so the horn on the `ơ` and
 * the grave on the `à` come off and the `Đ` stays -- and `don hang` finds nothing, which is
 * the single commonest word-initial letter in Vietnamese that a Telex-less keyboard cannot
 * type. It is the one case the general rule misses, so it is named here rather than left to
 * be rediscovered from a bug report.
 */
const D_STROKE = /[Đđ]/gu;

/** Case, accents and the stroke removed, so `don`, `DON` and `Đơn` are one needle. */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(DIACRITIC, "").replace(D_STROKE, "d").toLocaleLowerCase();
}

/**
 * The index, filtered and set in runs.
 *
 * `locale` decides the sort, so `Đ` files where a Vietnamese reader expects it and not where
 * a byte comparison would put it. It is passed rather than read from a global for the reason
 * every pure function here takes what it needs: two readers in two languages must be able to
 * exist in one test run.
 */
export function indexLabels(
  items: readonly BrowsedLabel[],
  query: string,
  locale: string,
): LabelRun[] {
  const needle = foldForSearch(query.trim());
  const matched =
    needle === "" ? items : items.filter((item) => foldForSearch(item.name).includes(needle));

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return RUN_ORDER.flatMap((kind) => {
    const run = matched
      .filter((item) => item.kind === kind)
      .sort((a, b) => collator.compare(a.name, b.name));
    return run.length === 0 ? [] : [{ kind, items: run }];
  });
}
