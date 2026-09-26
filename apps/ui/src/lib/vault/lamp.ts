/**
 * The lamp outside the vault: the same light the cover's film is drawn in, carried over the
 * rest of the public home, so the header and the sections under the cover answer the pointer
 * too (ADR 0065). Inside the cover the film paints its own lamp over an opaque ground, so this
 * one only shows where the film does not.
 *
 * It is a glow, not a picture. The page writes three custom properties (`--lamp-x`,
 * `--lamp-y`, `--lamp-strength`) onto `.landing`, and `landing-cover.css` draws the light from
 * them. Nothing here is React state: a pointer position sixty times a second would re-render the
 * whole page for a value only the stylesheet reads (`state.md`).
 *
 * The loop runs only while the light is still travelling or fading, and stops once it has
 * settled on the pointer. Under reduced motion the light jumps to the pointer and does not
 * glide; like the cover's lamp it still answers the hand, it just does not travel.
 */

export interface Glow {
  /** Where the light is centred, in pixels from the page's top left. */
  readonly x: number;
  readonly y: number;
  /** 0 when no pointer is over the page, 1 when one is. */
  readonly strength: number;
}

export interface Aim {
  readonly x: number;
  readonly y: number;
  /** Whether a pointer is over the page at all. */
  readonly on: boolean;
}

/** Before any pointer has been seen the page is unlit, and nothing glows where nobody pointed. */
export const DARK_GLOW: Glow = { x: 0, y: 0, strength: 0 };

/** The cover's own lamp follows at this rate, so the two lights move as one. */
const FOLLOW = 9;
const FADE = 6;
const NEAR_PX = 0.5;
const NEAR_STRENGTH = 0.01;

function approach(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

/** One frame of the light easing toward the pointer, or fading where it stands when there is none. */
export function followGlow(glow: Glow, aim: Aim, dt: number, still: boolean): Glow {
  const strength = aim.on ? 1 : 0;
  if (still) {
    return aim.on ? { x: aim.x, y: aim.y, strength } : { ...glow, strength };
  }
  const follow = 1 - Math.exp(-dt * FOLLOW);
  const fade = 1 - Math.exp(-dt * FADE);
  return {
    x: aim.on ? approach(glow.x, aim.x, follow) : glow.x,
    y: aim.on ? approach(glow.y, aim.y, follow) : glow.y,
    strength: approach(glow.strength, strength, fade),
  };
}

/** Whether the light has arrived: close enough that another frame would change nothing visible. */
export function settled(glow: Glow, aim: Aim): boolean {
  const faded = Math.abs(glow.strength - (aim.on ? 1 : 0)) < NEAR_STRENGTH;
  if (!aim.on) {
    return faded;
  }
  return faded && Math.abs(glow.x - aim.x) < NEAR_PX && Math.abs(glow.y - aim.y) < NEAR_PX;
}

/** Lights `page` from the pointer until the returned function is called. */
export function lightPage(page: HTMLElement): () => void {
  const still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  let glow = DARK_GLOW;
  let aim: Aim = { x: 0, y: 0, on: false };
  let frame = 0;
  let last = 0;

  function write(): void {
    page.style.setProperty("--lamp-x", `${glow.x.toFixed(1)}px`);
    page.style.setProperty("--lamp-y", `${glow.y.toFixed(1)}px`);
    page.style.setProperty("--lamp-strength", glow.strength.toFixed(3));
  }

  function tick(now: number): void {
    const dt = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    glow = followGlow(glow, aim, dt, still.matches);
    write();
    frame = settled(glow, aim) ? 0 : requestAnimationFrame(tick);
  }

  function wake(): void {
    if (frame === 0) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  }

  function move(event: PointerEvent): void {
    const box = page.getBoundingClientRect();
    aim = { x: event.clientX - box.left, y: event.clientY - box.top, on: true };
    if (glow.strength === 0) {
      // The first sighting lights where the pointer is, rather than sweeping in from a corner.
      glow = { x: aim.x, y: aim.y, strength: 0 };
    }
    wake();
  }

  function leave(): void {
    aim = { ...aim, on: false };
    wake();
  }

  page.addEventListener("pointermove", move);
  page.addEventListener("pointerleave", leave);
  return (): void => {
    cancelAnimationFrame(frame);
    page.removeEventListener("pointermove", move);
    page.removeEventListener("pointerleave", leave);
  };
}
