/**
 * The title page's sky: the light and the body's place on its course, from the reader's clock.
 */

import { describe, expect, test as it } from "bun:test";

import { courseAt, lightAt } from "./sky.ts";

describe("the title page's sky", () => {
  it("reads the light off the reader's own clock", () => {
    expect(lightAt(new Date(2027, 0, 12, 22, 14))).toBe("night");
    expect(lightAt(new Date(2027, 0, 12, 7, 30))).toBe("day");
  });

  it("draws a dawn sun at its rising end and a dusk sun at its setting end", () => {
    expect(courseAt(new Date(2027, 0, 12, 5, 30))).toBeLessThan(0.1);
    expect(courseAt(new Date(2027, 0, 12, 18, 30))).toBeGreaterThan(0.9);
  });
});
