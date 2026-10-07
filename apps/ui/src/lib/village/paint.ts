/**
 * The village's one way of putting colour on a model: a toon material with four stepped tones
 * under the one raking light, and a vertex colour in the design system's inks (`palette.ts`).
 *
 * Every model is repainted from `_cell` and `_shade`, the attributes the asset script writes in
 * place of each vertex's UV: which cell of KayKit's atlas the vertex was painted from, and how far
 * down that cell's gradient. Nothing keeps KayKit's own colours and nothing reads a texture.
 */

import {
  BufferAttribute,
  Color,
  DataTexture,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  type Object3D,
  RedFormat,
} from "three";

import { division } from "@/lib/divisions.ts";
import { type AtlasFacts, type Tokens, vertexColour } from "@/lib/village/palette.ts";

/** The four tones a face can take under the one raking light, darkest first. */
const TONE_STEPS = [0, 96, 176, 255];
/**
 * A figure's outline, finer than a building's: at a figure's size the building's line closes
 * over the face it is drawing.
 */
const FIGURE_OUTLINE = 0.0014;
/** `_shade` is a byte: 0 at the top of a cell's gradient, 255 at the bottom. */
const SHADE_FULL = 255;

/** The slip's ground is written as a literal in index.css, beside the slip; so here. */
const SLIP_GROUND = "#fdf0eb";

/** The book's tokens, off the stylesheet: the one place they are defined. */
export function readTokens(element: Element): Tokens {
  const style = getComputedStyle(element);
  function token(name: string, fallback: string): string {
    const value = style.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  }
  return {
    leaf: token("--leaf", "#fbf8f0"),
    page: token("--page", "#f7f3e7"),
    bone: token("--bone", "#efe9d9"),
    ink: token("--ink", "#16150f"),
    ink2: token("--ink-2", "#56513f"),
    ink3: token("--ink-3", "#6b6450"),
    teal: division("lake").hue,
    errata: token("--errata", "#cf2f16"),
    slip: SLIP_GROUND,
  };
}

function toonRamp(): DataTexture {
  const ramp = new DataTexture(new Uint8Array(TONE_STEPS), TONE_STEPS.length, 1, RedFormat);
  ramp.minFilter = NearestFilter;
  ramp.magFilter = NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export class Painter {
  readonly tokens: Tokens;
  private readonly material: MeshToonMaterial;
  private readonly figureMaterial: MeshToonMaterial;
  private readonly painted = new Map<string, BufferAttribute>();
  private readonly inks = new WeakMap<AtlasFacts, Map<string, Color>>();
  private readonly flats = new Map<string, MeshToonMaterial>();
  private readonly ramp = toonRamp();

  constructor(tokens: Tokens) {
    this.tokens = tokens;
    this.material = new MeshToonMaterial({ vertexColors: true, gradientMap: this.ramp });
    this.figureMaterial = this.material.clone();
    this.figureMaterial.userData = { outlineParameters: { thickness: FIGURE_OUTLINE } };
  }

  /**
   * One flat colour, shaded like everything else. `outlined: false` is for what lies flat on the
   * board, a road, whose outline would draw its seams.
   */
  flat(hex: string, outlined = true): MeshToonMaterial {
    const key = `${hex}|${outlined ? "outlined" : "bare"}`;
    const known = this.flats.get(key);
    if (known !== undefined) {
      return known;
    }
    const made = new MeshToonMaterial({ color: new Color(hex), gradientMap: this.ramp });
    if (!outlined) {
      made.userData = { outlineParameters: { visible: false } };
    }
    this.flats.set(key, made);
    return made;
  }

  /**
   * Repaints every mesh under `object` from its atlas cells. `roof` names the division whose hue
   * the team cells take, or `null`. Geometry is shared between clones of one piece, so a piece
   * painted twice under two roofs gets its own copy of the geometry for the second.
   */
  paint(object: Object3D, atlas: AtlasFacts, roof: Parameters<typeof division>[0] | null): void {
    const hue = roof === null ? null : division(roof).hue;
    object.traverse((child) => {
      if (child instanceof Mesh) {
        this.paintMesh(child, atlas, hue, this.material);
      }
    });
  }

  /** A character: painted the same way, outlined finer. */
  paintFigure(object: Object3D, atlas: AtlasFacts): void {
    object.traverse((child) => {
      if (child instanceof Mesh) {
        this.paintMesh(child, atlas, null, this.figureMaterial);
      }
    });
  }

  private paintMesh(
    mesh: Mesh,
    atlas: AtlasFacts,
    hue: string | null,
    material: MeshToonMaterial,
  ): void {
    const cells = mesh.geometry.getAttribute("_cell");
    const shades = mesh.geometry.getAttribute("_shade");
    if (cells === undefined) {
      mesh.material = this.flat(this.tokens.bone);
      return;
    }
    const key = `${mesh.geometry.uuid}|${hue ?? ""}`;
    let colours = this.painted.get(key);
    if (colours === undefined) {
      colours = new BufferAttribute(new Float32Array(cells.count * 3), 3);
      for (let at = 0; at < cells.count; at += 1) {
        const cell = Math.round(cells.getX(at));
        const shade = Math.round(shades?.getX(at) ?? SHADE_FULL / 2);
        const colour = this.ink(atlas, cell, shade, hue);
        colours.setXYZ(at, colour.r, colour.g, colour.b);
      }
      this.painted.set(key, colours);
    }
    const current = mesh.geometry.getAttribute("color");
    if (current !== colours) {
      if (current !== undefined) {
        mesh.geometry = mesh.geometry.clone();
      }
      mesh.geometry.setAttribute("color", colours);
    }
    mesh.material = material;
  }

  /** One vertex's ink, worked out once per cell, shade and roof. */
  private ink(atlas: AtlasFacts, cell: number, shade: number, hue: string | null): Color {
    let known = this.inks.get(atlas);
    if (known === undefined) {
      known = new Map();
      this.inks.set(atlas, known);
    }
    const key = `${cell}|${shade}|${hue ?? ""}`;
    let colour = known.get(key);
    if (colour === undefined) {
      colour = new Color(vertexColour(atlas, cell, shade / SHADE_FULL, hue));
      known.set(key, colour);
    }
    return colour;
  }

  dispose(): void {
    this.material.dispose();
    this.figureMaterial.dispose();
    for (const flat of this.flats.values()) {
      flat.dispose();
    }
    this.ramp.dispose();
  }
}
