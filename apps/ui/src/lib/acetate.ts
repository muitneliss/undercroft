/**
 * Solving the acetate.
 *
 * A leaf of milk acetate lying over a saturated divider board is only readable
 * if its opacity suits that board's hue, and the hues in this system run from
 * chrome yellow to ultramarine. Those two are nowhere near each other: pure
 * chrome yellow already clears 8:1 against the ink on its own, while pure
 * ultramarine manages 2.3:1. A single hand-picked alpha cannot serve both --
 * pick one that rescues ultramarine and the yellow board disappears under
 * milk; pick one that lets the yellow through and the blue section becomes
 * unreadable.
 *
 * So the alpha is not picked. It is solved, per board, by binary-searching the
 * source-over composite until the resulting field clears {@link TARGET_CONTRAST}
 * against the ink, and taking the LOWEST alpha that does. Lowest, not safest:
 * the whole point of acetate is that the board shows through, so the solver
 * spends every bit of translucency the contrast budget allows and no more.
 *
 * Compositing is done in gamma-encoded sRGB because that is where the browser
 * does it. `rgb(... / 0.4)` over a background is blended by the compositor in
 * the device colour space, not in linear light, so solving this in linear space
 * would produce a number that is defensible and wrong. Luminance, by contrast,
 * *is* defined on linearised channels (WCAG 2.1 relative luminance), so each
 * candidate composite is linearised only at the point of measurement.
 *
 * The result is a contrast guarantee rather than a hope, which is what lets this
 * design use a saturated ground under dense tabular content at all.
 */

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.

/** A gamma-encoded sRGB colour, 0-255 per channel. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The contrast the reading field must clear against the ink.
 *
 * Well above the 4.5:1 that WCAG 2.1 AA asks for body text. An operator reads
 * this interface for hours at a stretch, and the AA floor is a floor, not a
 * target; 10:1 keeps a form legible on the deepest board in the wheel while
 * still leaving the lightest one visibly translucent.
 */
export const TARGET_CONTRAST = 10;

/**
 * The constants of WCAG 2.1's colour maths, named as the specification names them.
 *
 * These are not tuning parameters and not ours to choose: change one and the contrast
 * figures this module reports stop meaning "WCAG contrast". They are spelled out here
 * rather than inline so that is obvious, and so the next reader can check them against
 * the spec without reverse-engineering an expression.
 *
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
const SRGB_CHANNEL_MAX = 255;
const SRGB_LINEAR_THRESHOLD = 0.040_45;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_DIVISOR = 1.055;
const SRGB_GAMMA_EXPONENT = 2.4;
const LUMINANCE_RED = 0.2126;
const LUMINANCE_GREEN = 0.7152;
const LUMINANCE_BLUE = 0.0722;
/** The flare constant. It keeps the ratio finite when one colour is pure black. */
const CONTRAST_FLARE = 0.05;

/** Parse `#rgb` or `#rrggbb`. Returns null for anything else rather than guessing. */
export function parseHex(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/u, "");

  if (/^[0-9a-f]{3}$/iu.test(value)) {
    const r = value.slice(0, 1);
    const g = value.slice(1, 2);
    const b = value.slice(2, 3);
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
    };
  }

  if (/^[0-9a-f]{6}$/iu.test(value)) {
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
    };
  }

  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  function channel(c: number): string {
    return Math.max(0, Math.min(SRGB_CHANNEL_MAX, Math.round(c)))
      .toString(16)
      .padStart(2, "0");
  }
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** sRGB transfer function, per WCAG 2.1. */
function linearise(channel: number): number {
  const c = channel / SRGB_CHANNEL_MAX;
  return c <= SRGB_LINEAR_THRESHOLD
    ? c / SRGB_LINEAR_DIVISOR
    : ((c + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_DIVISOR) ** SRGB_GAMMA_EXPONENT;
}

/** WCAG 2.1 relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  return (
    LUMINANCE_RED * linearise(r) + LUMINANCE_GREEN * linearise(g) + LUMINANCE_BLUE * linearise(b)
  );
}

/** WCAG 2.1 contrast ratio. Order-independent. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + CONTRAST_FLARE) / (darker + CONTRAST_FLARE);
}

/**
 * Source-over compositing, in gamma-encoded sRGB, which is where the browser
 * does it. `alpha` is the coverage of the leaf over the board.
 */
export function composite(leaf: Rgb, board: Rgb, alpha: number): Rgb {
  const a = Math.max(0, Math.min(1, alpha));
  return {
    r: a * leaf.r + (1 - a) * board.r,
    g: a * leaf.g + (1 - a) * board.g,
    b: a * leaf.b + (1 - a) * board.b,
  };
}

/** The stock and the ink, as `index.css` declares them. */
export const PAPER: Rgb = { r: 251, g: 248, b: 240 };
export const INK: Rgb = { r: 22, g: 21, b: 15 };

/**
 * Which of the two house colours to letter a saturated plate in.
 *
 * Derived, not declared. The wheel runs from chrome yellow to ultramarine, and a
 * single label colour cannot serve both: white on chrome yellow measures 2.09:1,
 * which is what the fore-edge rail shipped with until it was measured. Choosing
 * per hue by contrast means a division added later takes the right label without
 * anyone remembering to think about it -- and `acetate.test.ts` fails if a hue
 * is ever added that neither colour can letter legibly.
 */
export function letteringOn(boardHex: string): string {
  const board = parseHex(boardHex);
  if (!board) {
    return toHex(INK);
  }
  return contrast(board, INK) >= contrast(board, PAPER) ? toHex(INK) : toHex(PAPER);
}

export interface Solution {
  /** Coverage of the leaf over the board, 0-1. */
  alpha: number;
  /** The composite at that alpha, as an opaque hex. */
  ground: string;
  /** What the solved field actually achieves against the ink. */
  contrast: number;
}

/**
 * The lowest leaf coverage whose composite still clears `target` against `ink`.
 *
 * Contrast against a dark ink rises monotonically with alpha -- more leaf means
 * a lighter field means more contrast -- so a binary search is exact here rather
 * than merely convergent. Forty iterations puts the answer far below the
 * precision any renderer can express.
 *
 * Returns full coverage when even an opaque leaf cannot reach the target, which
 * is the honest answer: at that point the ink is wrong, not the alpha, and
 * silently returning a value that misses the target would hide it.
 */
export function solveLeaf(
  leaf: Rgb,
  board: Rgb,
  ink: Rgb,
  target: number = TARGET_CONTRAST,
): Solution {
  const opaque = composite(leaf, board, 1);
  if (contrast(opaque, ink) < target) {
    return { alpha: 1, ground: toHex(opaque), contrast: contrast(opaque, ink) };
  }

  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (contrast(composite(leaf, board, mid), ink) >= target) {
      high = mid;
    } else {
      low = mid;
    }
  }

  // Rounded UP, and everything else derived from the rounded value.
  //
  // The published alpha is what the browser composites with, so it is the one
  // that has to clear the target -- rounding it down to three places put the
  // field a whisker under (9.9976 against a target of 10) while `contrast`
  // below, computed from the unrounded search result, cheerfully reported a
  // pass. A solver that reports a figure it did not publish is worse than no
  // solver, because it is the thing that was supposed to catch this.
  const alpha = Math.min(1, Math.ceil(high * 1000) / 1000);
  const solved = composite(leaf, board, alpha);

  return {
    alpha,
    ground: toHex(solved),
    contrast: Math.round(contrast(solved, ink) * 100) / 100,
  };
}

/**
 * Solve for a board hue and publish the answer as custom properties.
 *
 * The stylesheet consumes `--leaf-alpha` (for the genuinely translucent hinged
 * leaf) and `--leaf-ground` (its opaque equivalent, for content inside the leaf
 * that should not pay for compositing). Called whenever the division changes;
 * cheap enough to call on every render, but it is called on change.
 *
 * Reads the leaf and ink colours off the element rather than hardcoding them, so
 * a change to the stock or the ink in CSS cannot silently invalidate the
 * solution computed here.
 */
export function applyBoard(element: HTMLElement, boardHex: string): Solution | null {
  const styles = getComputedStyle(element);
  const leaf = parseHex(styles.getPropertyValue("--leaf")) ?? { r: 251, g: 248, b: 240 };
  const ink = parseHex(styles.getPropertyValue("--ink")) ?? { r: 22, g: 21, b: 15 };
  const board = parseHex(boardHex);
  if (!board) {
    return null;
  }

  const solution = solveLeaf(leaf, board, ink);
  element.style.setProperty("--board", boardHex);
  element.style.setProperty("--leaf-alpha", String(solution.alpha));
  element.style.setProperty("--leaf-ground", solution.ground);
  return solution;
}
