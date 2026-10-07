/**
 * A design token's value, read off the document root, for ink the stylesheet cannot reach.
 *
 * Most of the interface takes its colours from `index.css` through a class. A few drawings do
 * not: Chart.js paints a canvas from JavaScript values, and a React Flow arrowhead is drawn
 * into a shared `<defs>` outside the edge whose class would colour it. Those read the token
 * here rather than carrying a hex literal copied out of the sheet, which would go on printing
 * the old ink the day the sheet's value changes.
 *
 * The fallback is what to draw when the sheet is not there to read -- a test document with no
 * stylesheet -- and it is the token's value at the time of writing, so the drawing still looks
 * like this interface rather than like a browser default.
 */
export function cssToken(name: `--${string}`, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}
