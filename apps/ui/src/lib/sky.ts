/**
 * The sky the title page is printed in, read off the reader's own clock.
 *
 * The device's hour says night, dawn, day or dusk, with no request and no permission. It is a
 * fact about the device, not a guess about the reader, and it is the only thing this page reads:
 * ADR 0118 removed the opt-in weather reading ADR 0115 put beside it, so the sign-in page asks
 * for no position and calls no third party.
 *
 * ## The clock says where the sun is, and nothing about the sky
 *
 * So nothing here names a cloud, a temperature or a clear night. Drawing stars because the clock
 * says night, or inking the sun because it says day, would be a confident picture of a sky
 * nobody read -- rule 2 broken in pixels. `Sky.tsx` prints the body in outline for that reason.
 */

/** Where the sun is, by the reader's clock. */
export type Light = "night" | "dawn" | "day" | "dusk";

const DAWN_FROM = 5;
const DAY_FROM = 7;
const DUSK_FROM = 17;
const NIGHT_FROM = 19;

/** The reader's local hour, read off their own clock. */
export function lightAt(now: Date): Light {
  const hour = now.getHours();
  if (hour < DAWN_FROM || hour >= NIGHT_FROM) {
    return "night";
  }
  if (hour < DAY_FROM) {
    return "dawn";
  }
  return hour < DUSK_FROM ? "day" : "dusk";
}

/**
 * How far along its course the sun or moon is, from 0 at its rising to 1 at its setting.
 *
 * The sun's course runs from dawn's first hour to night's, and the moon's the other way round,
 * on the same boundaries `lightAt` reads, so a dawn sun is never drawn at the setting end.
 */
export function courseAt(now: Date): number {
  const hours = now.getHours() + now.getMinutes() / 60;
  const night = lightAt(now) === "night";
  const sunUp = NIGHT_FROM - DAWN_FROM;
  const since = night ? hours - NIGHT_FROM : hours - DAWN_FROM;
  const span = night ? 24 - sunUp : sunUp;
  return Math.min(1, Math.max(0, (((since % 24) + 24) % 24) / span));
}
