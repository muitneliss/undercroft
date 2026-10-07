/**
 * What colour each part of the village is painted, in the book's own tokens (ADR 0115).
 *
 * KayKit paints every model from one gradient atlas per pack. The village never shows those
 * colours. The asset script keeps each atlas cell's mean colour (`assets/village/atlas.json`), and
 * this module repaints the cell from it:
 *
 *   - a TEAM cell, the one a building's roof and its flag wear, takes the hue of the division the
 *     building stands for (the Wheel Rule read literally: there the hue names the division);
 *   - a WATER cell takes Teal lifted toward Bone, the Raw lake's own ground;
 *   - every other cell takes the neutral whose lightness is nearest its own, from Leaf down to
 *     Ink, so a model keeps its drawing and loses its colour.
 *
 * Characters have no team cell, so a character can never wear a hue; `village.test.ts` holds
 * that. Vermilion is not in any of these: it is the errata slip's alone, drawn by the runtime.
 *
 * The neutrals are passed in rather than read here, so the runtime reads them off `index.css`
 * (one owner) and a test can pass the documented values.
 */

/** The book's neutrals and the slip's two colours, as `#rrggbb`. */
export interface Tokens {
  readonly leaf: string;
  readonly page: string;
  readonly bone: string;
  readonly ink: string;
  readonly ink2: string;
  readonly ink3: string;
  readonly teal: string;
  readonly errata: string;
  readonly slip: string;
}

/** What one atlas says about its cells; the shape `atlas.json` is written in. */
export interface AtlasFacts {
  readonly cells: readonly string[];
  readonly team?: readonly number[];
  readonly water?: readonly number[];
}

/** The tones a neutral cell may take, lightest first. */
export type Tone = "leaf" | "page" | "bone" | "stone" | "dusk" | "ink3" | "ink2" | "ink";

/** The lowest lightness (OKLab L) at which each tone starts, lightest first. */
const TONE_FLOORS: readonly (readonly [Tone, number])[] = [
  ["leaf", 0.9],
  ["page", 0.84],
  ["bone", 0.7],
  ["stone", 0.6],
  ["dusk", 0.5],
  ["ink3", 0.44],
  ["ink2", 0.32],
  ["ink", 0],
];

/** How far toward Bone the lake's Teal is lifted: water is the lake's ground, not its board. */
const WATER_LIFT = 0.55;

function channels(hex: string): readonly number[] {
  const digits = hex.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16));
}

function toHex([r, g, b]: readonly number[]): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(channel ?? 0)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** `a` moved `amount` of the way toward `b`, in sRGB: a printer's tint, not a light. */
export function mix(a: string, b: string, amount: number): string {
  const from = channels(a);
  const to = channels(b);
  return toHex(from.map((channel, at) => channel + ((to[at] ?? 0) - channel) * amount));
}

function linear(channel: number): number {
  const unit = channel / 255;
  return unit <= 0.040_45 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

/** OKLab lightness, 0 to 1: how light a colour looks, whatever its hue. */
export function lightness(hex: string): number {
  const [red = 0, green = 0, blue = 0] = channels(hex);
  const r = linear(red);
  const g = linear(green);
  const b = linear(blue);
  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
  return 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s;
}

/** The neutral a cell of this mean colour is painted. */
export function toneOf(hex: string): Tone {
  const light = lightness(hex);
  return (TONE_FLOORS.find(([, floor]) => light >= floor) ?? ["ink", 0])[0];
}

/** Each tone as a colour: the book's six neutrals, and two tints of Bone toward Ink between. */
export function toneColour(tokens: Tokens, tone: Tone): string {
  switch (tone) {
    case "leaf":
      return tokens.leaf;
    case "page":
      return tokens.page;
    case "bone":
      return tokens.bone;
    case "stone":
      return mix(tokens.bone, tokens.ink, 0.2);
    case "dusk":
      return mix(tokens.bone, tokens.ink, 0.36);
    case "ink3":
      return tokens.ink3;
    case "ink2":
      return tokens.ink2;
    case "ink":
      return tokens.ink;
    default: {
      const exhaustive: never = tone;
      throw new Error(`unhandled tone ${String(exhaustive)}`);
    }
  }
}

/**
 * The colour one atlas cell is painted. `roof` is the division hue of the building the cell
 * belongs to, or `null` for anything that stands for no division; a team cell of such a piece
 * is painted as a neutral like the rest.
 */
export function cellColour(
  tokens: Tokens,
  atlas: AtlasFacts,
  cell: number,
  roof: string | null,
): string {
  if (roof !== null && atlas.team?.includes(cell) === true) {
    return roof;
  }
  if (atlas.water?.includes(cell) === true) {
    return mix(tokens.teal, tokens.bone, WATER_LIFT);
  }
  return toneColour(tokens, toneOf(atlas.cells[cell] ?? tokens.bone));
}
