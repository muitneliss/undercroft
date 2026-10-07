/**
 * The glTF work `assets.ts` does to KayKit's files: reading the atlas, replacing each vertex's UV
 * with the cell it was painted from, re-keying clips on the village's frames, and bundling many
 * documents into one compressed file. `assets.ts` decides WHAT goes into the village; this is how.
 */

import { readFileSync } from "node:fs";

import {
  type Accessor,
  type Animation,
  type AnimationSampler,
  Document,
  type Scene,
} from "@gltf-transform/core";
import { dedup, mergeDocuments, meshopt, prune, unpartition } from "@gltf-transform/functions";
import type { MeshoptEncoder } from "meshoptimizer";
import { PNG } from "pngjs";

/** Every KayKit atlas is a grid of gradient swatches, eight across and four down. */
export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 4;

/** The village's frame rate (ADR 0116): a clip is sampled on these frames and held between. */
const FRAMES_PER_SECOND = 10;
/** Float slack when a key's time is compared with a frame's. */
const EPSILON = 1e-6;

/** The atlas cell a UV falls in, row-major from the top left (glTF's V runs downward). */
function cellOf(u: number, v: number): number {
  const column = Math.min(ATLAS_COLUMNS - 1, Math.max(0, Math.floor(u * ATLAS_COLUMNS)));
  const row = Math.min(ATLAS_ROWS - 1, Math.max(0, Math.floor(v * ATLAS_ROWS)));
  return row * ATLAS_COLUMNS + column;
}

/** How far down its cell's gradient a V falls, 0 at the top to 255 at the bottom. */
function shadeOf(v: number): number {
  const within = Math.min(1, Math.max(0, v * ATLAS_ROWS - Math.floor(v * ATLAS_ROWS)));
  return Math.round(within * 255);
}

/**
 * Each vertex's cell and where in the cell's gradient it sat, from a primitive's UVs; `null` for
 * a primitive with none. The gradient is most of a KayKit model's detail: a roof darkening toward
 * its eaves, a wall toward its foot.
 */
function cellsOf(
  uv: Accessor | null,
): { cells: Uint8Array<ArrayBuffer>; shades: Uint8Array<ArrayBuffer> } | null {
  const values = uv?.getArray();
  if (values === null || values === undefined) {
    return null;
  }
  const cells = new Uint8Array(values.length / 2);
  const shades = new Uint8Array(values.length / 2);
  for (let at = 0; at < cells.length; at += 1) {
    const v = values[at * 2 + 1] ?? 0;
    cells[at] = cellOf(values[at * 2] ?? 0, v);
    shades[at] = shadeOf(v);
  }
  return { cells, shades };
}

/** The atlas cells a document's meshes are painted from. */
export function cellsUsed(doc: Document): Set<number> {
  const used = new Set<number>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const cell of cellsOf(primitive.getAttribute("TEXCOORD_0"))?.cells ?? []) {
        used.add(cell);
      }
    }
  }
  return used;
}

/** Rows sampled at each end of a cell's gradient. */
const END_ROWS = 8;

/** The mean colour of a band of one cell's rows, as `#rrggbb`: its top end, or its bottom. */
function meanOf(png: PNG, column: number, row: number, end: "top" | "bottom"): string {
  const width = png.width / ATLAS_COLUMNS;
  const height = png.height / ATLAS_ROWS;
  const first = end === "top" ? row * height : (row + 1) * height - END_ROWS;
  const sum = [0, 0, 0];
  for (let y = first; y < first + END_ROWS; y += 1) {
    for (let x = column * width; x < (column + 1) * width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        sum[channel] = (sum[channel] ?? 0) + (png.data[(y * png.width + x) * 4 + channel] ?? 0);
      }
    }
  }
  const hex = sum.map((total) =>
    Math.round(total / (width * END_ROWS))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${hex.join("")}`;
}

/**
 * Each cell's gradient, row-major, as the colours at its two ends: what the cell looked like,
 * for the palette to read.
 */
export function cellGradients(path: string): { top: string[]; bottom: string[] } {
  const png = PNG.sync.read(readFileSync(path));
  const top: string[] = [];
  const bottom: string[] = [];
  for (let row = 0; row < ATLAS_ROWS; row += 1) {
    for (let column = 0; column < ATLAS_COLUMNS; column += 1) {
      top.push(meanOf(png, column, row, "top"));
      bottom.push(meanOf(png, column, row, "bottom"));
    }
  }
  return { top, bottom };
}

/** One sampler re-keyed on the frames: the pose the source had reached by each, held (STEP). */
function holdSampler(doc: Document, sampler: AnimationSampler): void {
  const output = sampler.getOutput();
  const times = sampler.getInput()?.getArray();
  const values = output?.getArray();
  if (
    output === null ||
    times === null ||
    times === undefined ||
    values === null ||
    values === undefined
  ) {
    return;
  }
  const size = output.getElementSize();
  const frames = Math.floor((times.at(-1) ?? 0) * FRAMES_PER_SECOND + EPSILON) + 1;
  const heldTimes = new Float32Array(frames);
  const heldValues = new Float32Array(frames * size);
  let key = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    heldTimes[frame] = frame / FRAMES_PER_SECOND;
    while (key + 1 < times.length && (times[key + 1] ?? 0) <= frame / FRAMES_PER_SECOND + EPSILON) {
      key += 1;
    }
    heldValues.set(values.slice(key * size, (key + 1) * size), frame * size);
  }
  sampler.setInput(doc.createAccessor().setType("SCALAR").setArray(heldTimes));
  sampler.setOutput(doc.createAccessor().setType(output.getType()).setArray(heldValues));
  sampler.setInterpolation("STEP");
}

/**
 * Re-keys a clip on the village's frames: one key per frame, interpolated STEP. Nothing moves
 * between two frames because there is nothing between them to move to.
 */
export function holdOnFrames(doc: Document, animation: Animation): void {
  for (const sampler of animation.listSamplers()) {
    holdSampler(doc, sampler);
  }
}

/** Drops every clip but `keep`, and answers the names in `keep` the document did not have. */
export function keepClips(doc: Document, keep: readonly string[]): string[] {
  for (const animation of doc.getRoot().listAnimations()) {
    if (!keep.includes(animation.getName())) {
      // A clip's samplers outlive it and keep their keys alive; they go first.
      for (const sampler of animation.listSamplers()) {
        sampler.dispose();
      }
      animation.dispose();
    }
  }
  const kept = new Set(
    doc
      .getRoot()
      .listAnimations()
      .map((animation) => animation.getName()),
  );
  return keep.filter((name) => !kept.has(name));
}

/**
 * Replaces each vertex's UV with the atlas cell it falls in (`_CELL`) and how far down that
 * cell's gradient (`_SHADE`), one byte each, and drops the textures. That is all the run time
 * reads, and a UV would not survive compression as one: quantising remaps a UV into its own
 * bounds, and the cell it named is lost with them.
 */
function stripPaint(doc: Document): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const painted = cellsOf(primitive.getAttribute("TEXCOORD_0"));
      if (painted !== null) {
        primitive.setAttribute(
          "_CELL",
          doc.createAccessor().setType("SCALAR").setArray(painted.cells),
        );
        primitive.setAttribute(
          "_SHADE",
          doc.createAccessor().setType("SCALAR").setArray(painted.shades),
        );
        primitive.setAttribute("TEXCOORD_0", null);
      }
    }
  }
  for (const texture of doc.getRoot().listTextures()) {
    texture.dispose();
  }
}

function isScene(property: unknown): property is Scene {
  return (
    typeof property === "object" &&
    property !== null &&
    "propertyType" in property &&
    property.propertyType === "Scene"
  );
}

/**
 * Merges each named document into one, under a top-level node with that name, so the run time
 * finds a piece by name and clones it. One file for the set and one for the cast: two requests
 * rather than thirty.
 */
export async function bundle(
  named: Readonly<Record<string, Document>>,
  encoder: typeof MeshoptEncoder,
): Promise<Document> {
  const out = new Document();
  const scene = out.createScene("village");
  for (const [name, doc] of Object.entries(named)) {
    stripPaint(doc);
    const map = mergeDocuments(out, doc);
    const holder = out.createNode(name);
    for (const merged of doc
      .getRoot()
      .listScenes()
      .map((source) => map.get(source))) {
      if (isScene(merged)) {
        for (const child of merged.listChildren()) {
          holder.addChild(child);
        }
        merged.dispose();
      }
    }
    scene.addChild(holder);
  }
  out.getRoot().setDefaultScene(scene);
  // Data nothing points at any more: the keys a clip held before it was re-keyed, a mannequin's
  // mesh. `prune` leaves a bare accessor alone, so it goes here.
  for (const accessor of out.getRoot().listAccessors()) {
    if (accessor.listParents().every((parent) => parent.propertyType === "Root")) {
      accessor.dispose();
    }
  }
  await out.transform(
    unpartition(),
    dedup(),
    prune({ keepLeaves: true }),
    meshopt({ encoder, level: "medium" }),
  );
  return out;
}
