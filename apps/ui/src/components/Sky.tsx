/**
 * The title page's sky: the board the sign-in leaf lies on, printed by the reader's clock.
 *
 * The sun or moon stands at its place on the day's course, on a dotted hairline it travels a
 * step a minute, and the board's ground follows the light (`data-light` on the page). Nothing
 * is eased (DESIGN.md: motion is stepped): a change of light is a new sheet inking in.
 *
 * ## The body is printed in outline, and no sky is drawn
 *
 * The clock says where the sun is, and nothing about the sky (`@/lib/sky` has the argument). So
 * the sun's disc and rays and the moon's crescent are outlines on the board's own ground, and no
 * cloud, rain or star is drawn: a clear sky nobody read would be a guess.
 */

import { courseAt, lightAt } from "@/lib/sky.ts";

/**
 * A point on the course, in percent of the arc's band: left at the rising, highest at the
 * middle of the course, right at the setting. A drawing of the hour, never printed as a time.
 */
function pointOn(along: number): { x: number; y: number } {
  return { x: 8 + along * 84, y: 86 - Math.sin(along * Math.PI) * 72 };
}

/** The whole course as a ruled hairline, the track the body travels along. */
const COURSE = Array.from({ length: 33 }, (_, index) => {
  const { x, y } = pointOn(index / 32);
  return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
}).join("");

/** The board's drawn layer. Presentation only: hidden from assistive technology. */
export function SkyBoard({ now }: { now: Date }): React.JSX.Element {
  const light = lightAt(now);
  const { x, y } = pointOn(courseAt(now));
  return (
    // Keyed by the light so a change of light is a new sheet inking in, not a mutation.
    <div className="sky" aria-hidden="true" key={light}>
      {/* The band the sun or moon travels in: the whole board on a wide screen, the strip above
          the leaf on a phone, where the leaf would otherwise cover it at every hour. */}
      <div className="sky__arc">
        <svg
          className="sky__course"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={COURSE} />
        </svg>
        <div className="sky__body" style={{ left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%` }}>
          {light === "night" ? <Moon /> : <Sun />}
        </div>
      </div>
    </div>
  );
}

const RAYS = Array.from({ length: 24 }, (_, index) => {
  const angle = (index * Math.PI) / 12;
  const outer = index % 2 === 0 ? 74 : 64;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return `M${(54 * cos).toFixed(2)} ${(54 * sin).toFixed(2)}L${(outer * cos).toFixed(2)} ${(outer * sin).toFixed(2)}`;
}).join("");

function Sun(): React.JSX.Element {
  return (
    <svg viewBox="-80 -80 160 160" aria-hidden="true">
      <path className="sky__rays" d={RAYS} />
      <circle className="sky__disc" r="42" />
    </svg>
  );
}

function Moon(): React.JSX.Element {
  return (
    <svg viewBox="-80 -80 160 160" aria-hidden="true">
      {/* A crescent: the outer limb, then the terminator back as a shallower arc. */}
      <path className="sky__disc" d="M14 -35.3A38 38 0 1 0 14 35.3A40 40 0 0 1 14 -35.3Z" />
    </svg>
  );
}
