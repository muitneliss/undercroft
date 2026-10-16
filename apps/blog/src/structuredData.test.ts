import { describe, expect, test as it } from "bun:test";
import { breadcrumbs, jsonLdText } from "./structuredData.ts";

describe("jsonLdText", () => {
  it("cannot end its script element, whatever a post's title says", () => {
    const node = breadcrumbs([
      { name: "Why </script> ends a page early", url: "https://blog.example.test/script" },
    ]);

    const text = jsonLdText(node);

    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual(node);
  });

  it("is the JSON itself when there is nothing to escape", () => {
    const node = breadcrumbs([{ name: "Raw lake", url: "https://blog.example.test/raw" }]);

    expect(jsonLdText(node)).toBe(JSON.stringify(node));
  });
});
