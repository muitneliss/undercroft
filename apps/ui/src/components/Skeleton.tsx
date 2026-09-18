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

// biome-ignore-all lint/nursery/noInlineStyles: Every one of these is data becoming a style: the tab rail's flexGrow IS the division's extent, the skeleton's width varies per row, the colour wheel paints each swatch its own hue. Biome's fix deletes the attribute rather than relocating it, which removes the feature.
// biome-ignore-all lint/style/noJsxLiterals: This would move all 77 pieces of UI copy into constants declared away from the markup that gives them meaning. That trade is worth making when a translation layer needs a key for every string; this app has none, so it buys nothing and costs the ability to read a component and see what it says.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/suspicious/noArrayIndexKey: A skeleton placeholder list with no identity and no reordering -- the index is the only key there is.

// biome-ignore-all lint/nursery/noReactNativeRawText: React Native rule: it requires text to sit inside a <Text> component, because RN has no text nodes. This is a web React app rendering to the DOM, where a string inside a <p> is exactly right. On under reactNative: all in biome.jsonc, suppressed where it does not apply.

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

export function Skeleton({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="setting" style={{ width: `${String(94 - ((i * 13) % 38))}%` }} />
      ))}
    </div>
  );
}
