import { describe, expect, test as it } from "bun:test";
import type { DashboardLayout } from "@undercroft/contracts/bi";

import { addTile, moveTile, removeTile, resizeTile } from "./dashboardLayout.ts";

const A = "0f0d1d7e-6a3c-4e1b-9a1e-000000000001";
const B = "0f0d1d7e-6a3c-4e1b-9a1e-000000000002";

const TWO: DashboardLayout = {
  tiles: [
    { questionId: A, x: 0, y: 0, w: 6, h: 4 },
    { questionId: B, x: 6, y: 2, w: 6, h: 3 },
  ],
};

describe("a dashboard's grid", () => {
  it("a tile moved past an edge stops at it", () => {
    const right = moveTile(TWO, A, 20, 0).tiles.find((t) => t.questionId === A);
    expect(right).toEqual({ questionId: A, x: 6, y: 0, w: 6, h: 4 });

    const up = moveTile(TWO, B, -20, -20).tiles.find((t) => t.questionId === B);
    expect(up).toEqual({ questionId: B, x: 0, y: 0, w: 6, h: 3 });
  });

  it("a tile never shrinks below two cells a side nor grows past the grid", () => {
    const tiny = resizeTile(TWO, A, -10, -10).tiles.find((t) => t.questionId === A);
    expect(tiny).toEqual({ questionId: A, x: 0, y: 0, w: 2, h: 2 });

    const huge = resizeTile(TWO, B, 20, 20).tiles.find((t) => t.questionId === B);
    expect(huge).toEqual({ questionId: B, x: 0, y: 2, w: 12, h: 12 });
  });

  it("an added question lands beneath the lowest tile, and is not added twice", () => {
    const c = "0f0d1d7e-6a3c-4e1b-9a1e-000000000003";
    const added = addTile(TWO, c);
    expect(added.tiles.at(-1)).toEqual({ questionId: c, x: 0, y: 5, w: 6, h: 4 });
    expect(addTile(added, c)).toBe(added);
  });

  it("removing a tile leaves the others where they were", () => {
    expect(removeTile(TWO, A).tiles).toEqual([{ questionId: B, x: 6, y: 2, w: 6, h: 3 }]);
  });
});
