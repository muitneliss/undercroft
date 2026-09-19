/**
 * What the join promises: a label reaches its region by code or by a name in either
 * language however it was accented or cased, and a label that reaches none is named
 * rather than dropped.
 */

import { describe, expect, test as it } from "bun:test";

import { joinRegions, type Region } from "./geoJoin.ts";

const PROVINCES: Region[] = [
  { code: "92", names: ["Cần Thơ", "Can Tho"] },
  { code: "79", names: ["Hồ Chí Minh", "Ho Chi Minh"] },
];

describe("joinRegions", () => {
  it("matches by code or by a folded name, and lists what matched nothing", () => {
    const joined = joinRegions(PROVINCES, [
      { label: "can tho", value: 1, raw: "1" },
      { label: "79", value: 2, raw: "2" },
      { label: "Hà Nội", value: 3, raw: "3" },
    ]);

    expect(joined.byCode.get("92")?.raw).toBe("1");
    expect(joined.byCode.get("79")?.raw).toBe("2");
    expect(joined.unmatched).toEqual(["Hà Nội"]);
  });

  it("keeps the first row for a region that two rows name", () => {
    const joined = joinRegions(PROVINCES, [
      { label: "CẦN THƠ", value: 1, raw: "1" },
      { label: "Can Tho", value: 5, raw: "5" },
    ]);
    expect(joined.byCode.get("92")?.raw).toBe("1");
    expect(joined.unmatched).toEqual([]);
  });
});
