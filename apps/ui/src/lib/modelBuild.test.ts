/**
 * What the build mark promises: a failed build reads as lapsed and a model never built as
 * absent, in the reader's words, and a status this does not know is not called a success.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { buildMark, buildMarkLabel } from "./modelBuild.ts";

const vi = translatorFor("vi");

describe("buildMark", () => {
  it("maps dbt's statuses onto the four marks and never guesses a success", () => {
    expect(buildMark("success")).toBe("granted");
    expect(buildMark("error")).toBe("lapsed");
    expect(buildMark(null)).toBe("absent");
    expect(buildMark("skipped")).toBe("pending");
    expect(buildMarkLabel(vi, "error")).toBe("Dựng lỗi");
    expect(buildMarkLabel(vi, null)).toBe("Chưa dựng");
  });
});
