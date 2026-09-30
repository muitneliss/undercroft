/**
 * What the Reports search promises: a name is found with its accents and the Đ stroke
 * ignored, across dashboards and questions alike, and an empty query hides nothing.
 */

import { describe, expect, test as it } from "bun:test";

import { byName } from "./reportSearch.ts";

const DASHBOARDS = [{ name: "Doanh thu tháng" }];
const QUESTIONS = [{ name: "Công nợ" }, { name: "Đơn hàng mới" }];

describe("byName", () => {
  it("finds a name with accents ignored, and nothing that does not hold it", () => {
    expect(byName(DASHBOARDS, "doanh thu")).toEqual(DASHBOARDS);
    expect(byName(QUESTIONS, "doanh thu")).toEqual([]);
    expect(byName(QUESTIONS, " cong no ")).toEqual([{ name: "Công nợ" }]);
    expect(byName(QUESTIONS, "don hang")).toEqual([{ name: "Đơn hàng mới" }]);
  });

  it("lists everything for an empty query", () => {
    expect(byName(QUESTIONS, "  ")).toEqual(QUESTIONS);
  });
});
