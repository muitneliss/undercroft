import { describe, expect, it } from "bun:test";

import { DARK_GLOW, followGlow, type Glow, settled } from "@/lib/vault/lamp.ts";

const FRAME = 1 / 60;

function run(glow: Glow, aim: Parameters<typeof followGlow>[1], frames: number): Glow {
  let now = glow;
  for (let frame = 0; frame < frames; frame += 1) {
    now = followGlow(now, aim, FRAME, false);
  }
  return now;
}

describe("the page lamp", () => {
  it("moves toward the pointer without passing it", () => {
    const start: Glow = { x: 0, y: 0, strength: 1 };
    const aim = { x: 400, y: -200, on: true };
    let glow = start;
    let last = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      glow = followGlow(glow, aim, FRAME, false);
      expect(glow.x).toBeGreaterThanOrEqual(last);
      expect(glow.x).toBeLessThanOrEqual(aim.x);
      expect(glow.y).toBeGreaterThanOrEqual(aim.y);
      last = glow.x;
    }
    expect(settled(glow, aim)).toBe(true);
  });

  it("is still travelling a moment after the pointer moved", () => {
    const aim = { x: 400, y: 300, on: true };
    const glow = run({ x: 0, y: 0, strength: 1 }, aim, 3);
    expect(glow.x).toBeGreaterThan(0);
    expect(settled(glow, aim)).toBe(false);
  });

  it("jumps straight to the pointer under reduced motion", () => {
    const aim = { x: 640, y: 120, on: true };
    const glow = followGlow({ x: 0, y: 0, strength: 0 }, aim, FRAME, true);
    expect(glow).toEqual({ x: 640, y: 120, strength: 1 });
    expect(settled(glow, aim)).toBe(true);
  });

  it("fades out where it stood when the pointer leaves, and back in when it returns", () => {
    const lit: Glow = { x: 300, y: 300, strength: 1 };
    const gone = run(lit, { x: 900, y: 900, on: false }, 120);
    expect(gone.strength).toBeLessThan(0.01);
    expect(gone.x).toBe(300);
    const back = run(gone, { x: 300, y: 300, on: true }, 120);
    expect(back.strength).toBeGreaterThan(0.99);
  });

  it("starts dark, so nothing glows before a pointer has been seen", () => {
    expect(DARK_GLOW.strength).toBe(0);
  });
});
