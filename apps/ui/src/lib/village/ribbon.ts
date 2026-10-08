/**
 * A road's surface: one flat strip of triangles along a line, mitred at every corner, so a road
 * of any length is one mesh rather than a box per stretch of it.
 */

import { BufferAttribute, BufferGeometry } from "three";

import type { Point } from "@/lib/village/layout.ts";

/** How far a corner's mitre may reach before it is cut back, as a multiple of the half-width. */
const MITRE_LIMIT = 2.5;

/** The unit direction from `a` to `b`, or nothing where the two are one point. */
function direction(a: Point | undefined, b: Point | undefined): Point {
  if (a === undefined || b === undefined) {
    return { x: 0, z: 0 };
  }
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  return length === 0 ? { x: 0, z: 0 } : { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
}

/**
 * The normal to the left of the line at one of its points, lengthened at a corner so the strip
 * keeps its width round it, and never past the mitre limit.
 */
function sideAt(line: readonly Point[], at: number): Point {
  const before = direction(line[at - 1], line[at]);
  const after = direction(line[at], line[at + 1]);
  const tx = before.x + after.x;
  const tz = before.z + after.z;
  const length = Math.hypot(tx, tz) || 1;
  const normal = { x: -tz / length, z: tx / length };
  const incoming = before.x === 0 && before.z === 0 ? after : before;
  const along = Math.abs(-incoming.z * normal.x + incoming.x * normal.z) || 1;
  const stretch = Math.min(MITRE_LIMIT, 1 / along);
  return { x: normal.x * stretch, z: normal.z * stretch };
}

/** One strip along a line at height `y`, `width` across, facing up. */
export function ribbon(line: readonly Point[], width: number, y: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [at, point] of line.entries()) {
    const side = sideAt(line, at);
    const half = width / 2;
    positions.push(point.x + side.x * half, y, point.z + side.z * half);
    positions.push(point.x - side.x * half, y, point.z - side.z * half);
    if (at > 0) {
      const a = (at - 1) * 2;
      // Wound counter-clockwise seen from above, so the strip faces up.
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
