// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";
import { canonicalJson, canonicalJsonFromText, parseLossless } from "./canonicalJson.ts";

describe("canonical JSON is byte-stable", () => {
  it("orders keys regardless of the order the source sent them", () => {
    const a = canonicalJsonFromText('{"b":1,"a":2}');
    const b = canonicalJsonFromText('{"a":2,"b":1}');
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it("orders nested keys too", () => {
    expect(canonicalJsonFromText('{"z":{"y":1,"x":2}}')).toBe('{"z":{"x":2,"y":1}}');
  });

  it("emits no whitespace between tokens", () => {
    expect(canonicalJsonFromText('{ "a" : [ 1 , 2 ] }')).toBe('{"a":[1,2]}');
  });

  it("preserves array order, which is data rather than presentation", () => {
    expect(canonicalJsonFromText("[3,1,2]")).toBe("[3,1,2]");
  });
});

describe("numbers survive verbatim", () => {
  it.each([
    ["a 25-digit integer", "1234567890123456789012345"],
    ["sub-cent precision", "8500.0001"],
    ["a value beyond double range", "1e400"],
    ["negative zero", "-0"],
    ["a trailing zero the source chose to send", "1.50"],
    ["high precision", "0.1000000000000000000000001"],
  ])("%s round-trips unchanged: %p", (_label, literal) => {
    expect(canonicalJsonFromText(`{"n":${literal}}`)).toBe(`{"n":${literal}}`);
  });

  it("JSON.parse would have destroyed what we preserve", () => {
    const literal = "1234567890123456789012345";
    // The defect this module exists to prevent, shown rather than asserted about.
    expect(JSON.stringify(JSON.parse(`{"n":${literal}}`))).not.toBe(`{"n":${literal}}`);
    expect(canonicalJsonFromText(`{"n":${literal}}`)).toBe(`{"n":${literal}}`);
  });

  it("refuses a JavaScript number rather than hashing a value nobody sent", () => {
    expect(() => canonicalJson({ n: 8500.0001 })).toThrow(/refusing to canonicalise/u);
  });

  it("accepts a bigint, which is exact", () => {
    expect(canonicalJson({ n: 90071992547409911n })).toBe('{"n":90071992547409911}');
  });
});

describe("strings are escaped to ASCII", () => {
  it.each([
    ['a "quote"', '"a \\"quote\\""'],
    ["back\\slash", '"back\\\\slash"'],
    ["line\nbreak", '"line\\nbreak"'],
    ["tab\there", '"tab\\there"'],
  ])("escapes %p", (input, expected) => {
    expect(canonicalJson(input)).toBe(expected);
  });

  it("escapes a control character that has no short form", () => {
    expect(canonicalJson("")).toBe('"\\u0001"');
  });

  it("escapes non-ASCII so the bytes do not depend on an encoding assumption", () => {
    expect(canonicalJson("café")).toBe('"caf\\u00e9"');
    expect(canonicalJson("中文")).toBe('"\\u4e2d\\u6587"');
  });

  it("writes a non-BMP code point as a surrogate pair", () => {
    // U+1F5FF, outside the BMP. Naive per-code-unit handling mangles this.
    expect(canonicalJson("\u{1F5FF}")).toBe('"\\ud83d\\uddff"');
  });

  it("output is pure ASCII whatever went in", () => {
    const serialised = canonicalJson({ "\u{1F5FF}": "café", plain: "ok" });
    // eslint-disable-next-line no-control-regex -- asserting the absence of non-ASCII is the point
    expect(/^[\x00-\x7F]*$/u.test(serialised)).toBe(true);
  });

  it("sorts keys by code point, not by UTF-16 code unit", () => {
    // U+FF01 (65281) sorts before U+1F5FF (128511) by code point. By UTF-16 code
    // unit the order reverses, because U+1F5FF leads with the surrogate 0xD83D
    // (55357) -- which is what JavaScript's default string comparison would do.
    const serialised = canonicalJson({ "\u{1F5FF}": 1n, "！": 2n });
    expect(serialised.indexOf("uff01")).toBeLessThan(serialised.indexOf("ud83d"));
  });
});

describe("golden bytes", () => {
  it("a representative payload hashes to a pinned digest", () => {
    // If this digest changes, every content address in every lake changes with it.
    // That is a deliberate, breaking act -- not a refactor.
    const text = `{"total":"8500.0001","id":1234567890123456789012345,"name":"café","nested":{"b":true,"a":null},"list":[1,"two",false]}`;
    const canonical = canonicalJsonFromText(text);
    expect(canonical).toBe(
      '{"id":1234567890123456789012345,"list":[1,"two",false],"name":"caf\\u00e9",' +
        '"nested":{"a":null,"b":true},"total":"8500.0001"}',
    );
    expect(new Bun.CryptoHasher("sha256").update(canonical).digest("hex")).toBe(
      "5296d956be70aafa9efdd701b428eb5512fd194aaabdd33d674fef7b5ca89469",
    );
  });

  it("parseLossless keeps numbers out of float", () => {
    const parsed = parseLossless('{"n":8500.0001}') as { n: { toString: () => string } };
    expect(parsed.n.toString()).toBe("8500.0001");
  });
});
