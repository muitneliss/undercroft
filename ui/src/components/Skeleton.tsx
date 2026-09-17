/**
 * Loading placeholders shaped like the content that is coming.
 *
 * A spinner in the middle of a panel says "something is happening"; a skeleton
 * says what is about to be there, which keeps the layout from jumping and gives
 * the eye somewhere to be. `aria-busy` carries the same fact to a screen reader,
 * which cannot see either.
 */

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ width: `${100 - i * 12}%`, height: "1.25rem" }}
        />
      ))}
    </div>
  );
}
