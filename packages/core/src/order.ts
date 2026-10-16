/**
 * Lexicographic order by UTF-16 code unit -- the order a bare `.sort()` gives strings,
 * written down.
 *
 * Spelled out because a bare `.sort()` says it only by omission, and an omission is what the
 * next reader "fixes": into a numeric comparator, which is wrong for strings, or into
 * `localeCompare`, which orders by locale, so the same strings come back in a different order
 * on a different machine. Anything that compares, prunes or snapshots by order needs the same
 * answer everywhere. It is also the order S3 lists keys in (`@undercroft/lake`'s `list`).
 *
 * Dependency-free and exported on its own path, like `./locale`, so the browser may import it
 * without the root barrel's `node:crypto`.
 */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
