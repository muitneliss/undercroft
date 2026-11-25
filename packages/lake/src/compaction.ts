/**
 * Which observations of one key say nothing the one before them did not. ADR 0160.
 *
 * The rule, apart from the I/O that feeds it, because the rule is what makes compaction
 * LOSSLESS and is worth reading on its own: an observation is redundant only when its
 * canonical text equals that of the observation kept immediately before it. So the sequence
 * of distinct payloads a key went through -- A, then C, then A again -- survives whole, each
 * at the stamp it first appeared; what goes is the repetition in between (A, B≡A, A, B≡A).
 *
 * What counts as "equal" is not decided here. `LakeStore` addresses bytes and must not know
 * which arrays a source shuffles (ADR 0158), so the caller hands in a `Canonicaliser` built
 * from the spec's own declaration. One that cannot say -- the bytes do not parse -- answers
 * `null`, and `null` equals nothing, not even another `null`: an observation nobody could read
 * is kept, because "could not compare" is not "the same" (CLAUDE.md, rule 2).
 *
 * Two observations are kept whatever they hold:
 *
 * - **the first**, which is the run's first appearance and the record's first sighting;
 * - **the last one considered**, because the caller hands in only what the loader has passed,
 *   and the last of those is the one `raw.records` was projected from. When the loader has
 *   passed everything it is the key's newest, which `LakeStore.put` compares a new payload
 *   against and `raw.records.lake_stamp` names -- so it is never removed.
 */

/**
 * A payload's canonical text, or `null` when it cannot be read as one.
 *
 * Two payloads with equal canonical text are the same record as far as the source's spec is
 * concerned. Built by the caller -- for a connector, `canonicalPayload` over the entity's
 * `unorderedArrays` -- and never by the store.
 */
export type Canonicaliser = (bytes: Uint8Array) => string | null;

/** One observation, in stamp order, with its canonical text already worked out. */
export interface Considered {
  readonly stamp: string;
  readonly canonical: string | null;
}

/** The stamps among `ordered` (oldest first) that repeat the observation kept before them. */
export function redundantStamps(ordered: readonly Considered[]): string[] {
  const redundant: string[] = [];
  const lastIndex = ordered.length - 1;
  let kept: string | null = null;
  for (const [index, { stamp, canonical }] of ordered.entries()) {
    const repeats = canonical !== null && canonical === kept;
    if (index > 0 && index < lastIndex && repeats) {
      redundant.push(stamp);
    } else {
      kept = canonical;
    }
  }
  return redundant;
}
