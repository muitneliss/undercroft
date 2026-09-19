import { describe, expect, test as it } from "bun:test";
import { parseLossless } from "./canonicalJson.ts";
import { getPath, getStringPath, parsePath } from "./getPath.ts";

const payload = parseLossless(`{
  "paging": { "next": { "link": "https://api.example.test/next" } },
  "results": [{ "id": "1", "props": { "amount": "10.00" } }, { "id": "2" }],
  "count": 1234567890123456789012345,
  "blank": "",
  "nothing": null
}`);

describe("parsePath", () => {
  it.each([
    ["", []],
    ["a", ["a"]],
    ["a.b.c", ["a", "b", "c"]],
    ["results[0]", ["results", "0"]],
    ["results[0].id", ["results", "0", "id"]],
    ["a[0][1]", ["a", "0", "1"]],
  ])("parses %p", (path, expected) => {
    expect(parsePath(path)).toEqual(expected);
  });
});

describe("getPath", () => {
  it("reads a nested value", () => {
    expect(getPath(payload, "paging.next.link")).toBe("https://api.example.test/next");
  });

  it("reads through an array index", () => {
    expect(getPath(payload, "results[1].id")).toBe("2");
  });

  it("returns undefined for a missing step rather than throwing", () => {
    expect(getPath(payload, "paging.previous.link")).toBeUndefined();
    expect(getPath(payload, "results[9].id")).toBeUndefined();
    expect(getPath(payload, "nothing.anything")).toBeUndefined();
  });

  it("an empty path is the whole document", () => {
    expect(getPath(payload, "")).toBe(payload);
  });

  it("refuses to walk into the prototype chain", () => {
    // A spec pointing here would otherwise return a function where the caller
    // expected a record id -- silently the wrong kind of thing.
    expect(getPath(payload, "constructor")).toBeUndefined();
    expect(getPath(payload, "__proto__")).toBeUndefined();
    expect(getPath({}, "constructor.prototype")).toBeUndefined();
  });

  it("does not find inherited properties", () => {
    expect(getPath({}, "toString")).toBeUndefined();
  });
});

describe("getStringPath", () => {
  it("reads a string", () => {
    expect(getStringPath(payload, "results[0].id")).toBe("1");
  });

  it("renders a large number as its digits rather than losing them", () => {
    expect(getStringPath(payload, "count")).toBe("1234567890123456789012345");
  });

  it("treats an empty string as absent, because an empty id is not an id", () => {
    expect(getStringPath(payload, "blank")).toBeNull();
  });

  it("returns null rather than coercing an object or a null", () => {
    expect(getStringPath(payload, "paging")).toBeNull();
    expect(getStringPath(payload, "nothing")).toBeNull();
    expect(getStringPath(payload, "missing")).toBeNull();
  });
});
