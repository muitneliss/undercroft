/**
 * The device.
 *
 * An undercroft is the vaulted chamber beneath a building -- the part that holds
 * everything up and outlives what stands on it. The mark is that sentence drawn:
 * an inked block, and cut through it a round-headed arch of three orders.
 *
 * WHY A BLOCK WITH A HOLE IN IT, AND NOT A DRAWN ARCH. The first cut of this was
 * an arch standing under a heavy rule, the rule being the floor above. It read as
 * a bar floating over a shape -- two objects, and at 16px a hat. The mass above
 * an undercroft is not a line, it is the building, so it is drawn as the thing it
 * is: the block is the mass, the arch is the void, and "under" is the one thing
 * the silhouette cannot fail to say. It is also literally how a printer's device
 * is made -- the mark is what remains of the block after the cutting.
 *
 * WHY THREE ORDERS. A Romanesque portal is cut in orders -- concentric archivolts
 * stepping back into the wall -- and here the three steps are the three layers of
 * the product, in the order the README puts them: the outer cut is what a
 * customer reads (dbt models, dashboards), the ring is the projection in
 * Postgres, the core is raw. Drop the outer orders and the arch still stands; cut
 * the core out and there is no arch. The impost -- the block an arch springs from
 * -- is the tie left uncut across each pier at the springing line, and it is what
 * keeps three concentric curves reading as architecture rather than as a target.
 *
 * WHY THE ARCH IS A HOLE AND NOT A PALE SHAPE. `index.css` decides it for the
 * punch on a hinged leaf: a hole must show what is behind it, and two punches
 * painted in a fixed tone read as smudges rather than holes. So the orders are
 * cut out of one `evenodd` path rather than painted over it, and the arch fills
 * with whatever the mark is actually set on -- page stock in the running head,
 * leaf on the title page, a section board's hue anywhere it is set on one. The
 * mark is never a sticker sitting on the page; it is punched through it.
 *
 * WHY ONE INK. The seven-hue wheel in `@/lib/divisions` is how this interface
 * says where you are, and vermilion is held back so an erratum can be the only
 * thing wearing it. A mark that took a colour would either claim one of the seven
 * -- making the identity look like one division -- or want an eighth. So the
 * block is `currentColor` and takes the ink of whatever it is set in. Colour
 * reaches the mark only by showing through it.
 *
 * WHY IT IS BUILT LIKE AN ICON. Same authored geometry as `@/components/Icon`, on
 * a 32-unit grid that is exactly twice the icon grid, so every radius and every
 * edge lands on the same half-unit the interface's glyphs do. `public/favicon.svg`
 * and `public/mark.svg` carry this same path; if the geometry changes here, it
 * changes there.
 *
 * It is `aria-hidden` everywhere it appears, because it appears beside the word
 * Undercroft every time, and announcing both would say the name twice.
 */

/** The block: a cut sheet of board, at the radius the rest of the system cuts. */
const BLOCK = "M3 0h26a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z";

/**
 * The three orders, then the two impost ties.
 *
 * Under `evenodd` each order alternates: the outer order opens the wall, the
 * second closes it again into the ring, the third opens the core. The ties are
 * inside the outer order, so they fill back in as ink and bridge each pier to the
 * block at the springing line.
 */
const ARCH = [
  "M5 27.5V15.5a11 11 0 0 1 22 0V27.5Z",
  "M9 27.5V15.5a7 7 0 0 1 14 0V27.5Z",
  "M12.5 27.5V15.5a3.5 3.5 0 0 1 7 0V27.5Z",
  "M5 15.5h4v1.5H5Z",
  "M23 15.5h4v1.5h-4Z",
].join("");

export function Mark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={BLOCK + ARCH} />
    </svg>
  );
}
