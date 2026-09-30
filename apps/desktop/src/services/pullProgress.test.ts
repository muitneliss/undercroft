import { describe, expect, it } from "bun:test";
import { imageLine } from "./pullProgress.ts";

describe("imageLine", () => {
  it("reads an image's start, end and failure in both compose dialects", () => {
    expect(
      [
        " Image postgres:17.6 Pulling ",
        " Image postgres:17.6 Pulled ",
        " kestra Pulling",
        " kestra Error pull access denied for kestra/kestra",
        " worker Skipped - Image is already being pulled by control-plane",
      ].map(imageLine),
    ).toEqual([
      { image: "postgres:17.6", state: "pulling" },
      { image: "postgres:17.6", state: "pulled" },
      { image: "kestra", state: "pulling" },
      { image: "kestra", state: "failed" },
      { image: "worker", state: "pulling" },
    ]);
  });

  it("does not mistake a layer's progress for an image", () => {
    expect(
      [
        " 821d9dafb26d Pulling fs layer 0B",
        " 821d9dafb26d Pull complete 0B",
        " 9986a736f7d3 Pulled",
        " 821d9dafb26d Downloading 1.049MB",
        "",
      ].map(imageLine),
    ).toEqual([null, null, null, null, null]);
  });
});
