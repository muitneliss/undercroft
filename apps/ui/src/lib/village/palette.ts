/**
 * What colour each part of the village is painted: the design system's own inks (ADR 0116).
 *
 * KayKit paints every model from a gradient atlas. The village keeps KayKit's drawing and none of
 * its colours: every vertex is repainted along one of the design system's tonal ramps
 * (`apps/ui/.impeccable/design.json`, copied below and held to it by `village.test.ts`).
 *
 *   - A vertex's source colour is its atlas cell's gradient at the height the vertex sat in it
 *     (`_SHADE`), so a roof still darkens toward its eaves and a sleeve toward its cuff.
 *   - Its FAMILY is read from its hue: a grey takes the Bone or Ink ramp, a green Grass, a blue
 *     Ultramarine, a cyan Teal, a purple Violet, a strong yellow Chrome, a strong red or orange
 *     Oxide, and an earth (wood, leather, skin, sand) Sienna.
 *   - Its colour is that ramp read at its lightness: between the two steps either side of it, so
 *     a surface shades smoothly through the system's own colours and never leaves its ramp.
 *
 * Two exceptions, both the book's rules:
 *
 *   - A division's own hue, the canonical step of its ramp, is worn only by a building's TEAM
 *     cells, its roof and its flag, because there the hue names the division (the Wheel Rule)
 *     and pressing the building opens it. Everything else takes the ramp's other steps, so a
 *     wheat field is never read as the Sources board. A piece that stands for no division paints
 *     its team cells in Bone.
 *   - Vermilion is in no ramp here. It is the errata slip's, drawn by the runtime; a red cell
 *     takes Oxide.
 *
 * Water is the lake's: the Teal ramp, whatever blue KayKit chose.
 */

import { DIVISIONS } from "@/lib/divisions.ts";

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
  /** Each cell's colour at the top of its gradient, row-major. */
  readonly top: readonly string[];
  /** And at the bottom. */
  readonly bottom: readonly string[];
  readonly team?: readonly number[];
  readonly water?: readonly number[];
}

export type Family =
  | "chrome"
  | "oxide"
  | "grass"
  | "teal"
  | "ultramarine"
  | "violet"
  | "sienna"
  | "bone"
  | "ink";

/** The design system's tonal ramps, darkest first, exactly as `design.json` gives them. */
export const RAMPS: Readonly<Record<Family, readonly string[]>> = {
  chrome: ["#2b1e00", "#4a3300", "#6b4a00", "#8f6300", "#b57e00", "#eda600", "#f6cf66", "#fbe9b8"],
  oxide: ["#2a1106", "#4a1e0b", "#6a2c10", "#8c3a14", "#b24b1a", "#cf6f3f", "#e6a180", "#f6d9c9"],
  grass: ["#0e1d0a", "#193313", "#264c1c", "#326124", "#3e782b", "#63994f", "#98bf88", "#d3e4cb"],
  teal: ["#031c1b", "#063230", "#094b49", "#0c6060", "#0f7673", "#3f9896", "#83bfbd", "#c9e4e3"],
  ultramarine: [
    "#081226",
    "#0f2147",
    "#173368",
    "#1d3f83",
    "#234c9e",
    "#5272b7",
    "#8fa5d2",
    "#cdd7ec",
  ],
  violet: ["#17122a", "#29204d", "#3e3070", "#503e90", "#634cb0", "#8672c4", "#b0a3d9", "#dcd6ee"],
  sienna: ["#1e0f08", "#361b0f", "#502816", "#67341c", "#7f4023", "#a4633f", "#c89577", "#e8d0bf"],
  bone: ["#2a2818", "#4a4630", "#6b664a", "#8f8968", "#b5ae8d", "#d6cfba", "#efe9d9", "#f7f3e7"],
  ink: ["#16150f", "#2b2919", "#3f3c26", "#56513f", "#6b6450", "#8f8768", "#b5ae8d", "#d6cfba"],
};

/** The divisions' own hues: the roofs', and nothing else's. */
const RESERVED: ReadonlySet<string> = new Set(DIVISIONS.map((division) => division.hue));

/** Below this chroma a colour is a grey and takes the neutrals. */
const GREY = 0.035;
/** Below this chroma a warm colour is an earth (wood, skin, sand) rather than a paint. */
const EARTH = 0.1;
/** Above this lightness a grey is the board's own stock, Bone; below, Ink. */
const STOCK = 0.62;
/** The hue, in OKLCH degrees, each painted family is read from. */
const HUES: readonly (readonly [Family, number])[] = [
  ["oxide", 40],
  ["chrome", 85],
  ["grass", 135],
  ["teal", 195],
  ["ultramarine", 262],
  ["violet", 295],
];
/** Warm hues: where an earth takes Sienna. */
const WARM_FROM = 15;
const WARM_TO = 105;
/** How far toward white KayKit's water is lifted before it is printed: it is a lake, not a sea. */
const WATER_LIFT = 0.55;

function channels(hex: string): readonly number[] {
  const digits = hex.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16));
}

function toHex(values: readonly number[]): string {
  return `#${values
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
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

interface Lch {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
}

/** OKLCH: how light a colour looks, how strongly coloured, and which way round the wheel. */
function oklch(hex: string): Lch {
  const [red = 0, green = 0, blue = 0] = channels(hex);
  const r = linear(red);
  const g = linear(green);
  const b = linear(blue);
  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
  const a = 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s;
  const yellowBlue = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s;
  return {
    lightness: 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    chroma: Math.hypot(a, yellowBlue),
    hue: ((Math.atan2(yellowBlue, a) * 180) / Math.PI + 360) % 360,
  };
}

function around(a: number, b: number): number {
  const apart = Math.abs(a - b) % 360;
  return Math.min(apart, 360 - apart);
}

/** Which ramp a colour is printed from. */
function familyOf(hex: string): Family {
  const { lightness, chroma, hue } = oklch(hex);
  if (chroma < GREY) {
    return lightness > STOCK ? "bone" : "ink";
  }
  if (hue >= WARM_FROM && hue <= WARM_TO && chroma < EARTH) {
    return "sienna";
  }
  let nearest: Family = "sienna";
  let closest = Number.POSITIVE_INFINITY;
  for (const [family, centre] of HUES) {
    if (around(hue, centre) < closest) {
      nearest = family;
      closest = around(hue, centre);
    }
  }
  return nearest;
}

/**
 * A ramp read at a colour's lightness: the mix of the two steps either side of it, or the end
 * step past either end. A division's own hue is left out of the ramp, so only a roof wears it.
 */
function alongRamp(ramp: readonly string[], hex: string): string {
  const { lightness } = oklch(hex);
  const steps = ramp
    .filter((step) => !RESERVED.has(step))
    .map((step) => ({ step, lightness: oklch(step).lightness }));
  const [first] = steps;
  const last = steps.at(-1);
  if (first === undefined || last === undefined) {
    return hex;
  }
  if (lightness <= first.lightness) {
    return first.step;
  }
  for (let at = 1; at < steps.length; at += 1) {
    const below = steps[at - 1];
    const above = steps[at];
    if (below !== undefined && above !== undefined && lightness <= above.lightness) {
      const share = (lightness - below.lightness) / (above.lightness - below.lightness);
      return mix(below.step, above.step, share);
    }
  }
  return last.step;
}

/**
 * The colour a vertex is painted: its cell's gradient at `shade` (0 top, 1 bottom), read along
 * its family's ramp. `roof` is the division hue of the building the vertex belongs to, or `null`.
 */
export function vertexColour(
  atlas: AtlasFacts,
  cell: number,
  shade: number,
  roof: string | null,
): string {
  const source = mix(atlas.top[cell] ?? "#808080", atlas.bottom[cell] ?? "#808080", shade);
  if (atlas.team?.includes(cell) === true) {
    return roof ?? alongRamp(RAMPS.bone, source);
  }
  if (atlas.water?.includes(cell) === true) {
    return alongRamp(RAMPS.teal, mix(source, "#ffffff", WATER_LIFT));
  }
  return alongRamp(RAMPS[familyOf(source)], source);
}
