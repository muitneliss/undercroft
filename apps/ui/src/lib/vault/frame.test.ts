import { describe, expect, it } from "bun:test";

import { contrast, parseHex } from "@/lib/acetate.ts";
import { DAY, NIGHT, type Palette, paletteFor } from "@/lib/vault/frame.ts";
import { STAGES } from "@/lib/vault/model.ts";

/** WCAG 2.1: 4.5:1 for text, 3:1 for a graphical object that has to be seen. */
const TEXT = 4.5;
const MARK = 3;

function against(palette: Palette, colour: string): number {
  const ground = parseHex(palette.ground);
  const ink = parseHex(colour);
  if (ground === null || ink === null) {
    throw new Error(`not a hex colour: ${palette.ground} / ${colour}`);
  }
  return contrast(ground, ink);
}

describe("the vault's two palettes", () => {
  for (const [name, palette] of [
    ["night", NIGHT],
    ["day", DAY],
  ] as const) {
    it(`letters its text legibly on the ${name} ground`, () => {
      // The proof slip is set in ink and accent; the sources are lettered in their tone.
      expect(against(palette, palette.ink)).toBeGreaterThanOrEqual(TEXT);
      expect(against(palette, palette.accent)).toBeGreaterThanOrEqual(TEXT);
      expect(against(palette, palette.tones.sources)).toBeGreaterThanOrEqual(TEXT);
    });

    it(`keeps every lit column visible on the ${name} ground`, () => {
      for (const stage of STAGES) {
        expect(against(palette, palette.tones[stage])).toBeGreaterThanOrEqual(MARK);
      }
      expect(against(palette, palette.people)).toBeGreaterThanOrEqual(MARK);
    });
  }

  it("is chosen by the reader's colour scheme", () => {
    expect(paletteFor(true)).toBe(NIGHT);
    expect(paletteFor(false)).toBe(DAY);
  });
});
