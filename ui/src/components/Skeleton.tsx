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

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="setting"
          style={{ width: `${String(94 - ((i * 13) % 38))}%` }}
        />
      ))}
    </div>
  );
}
