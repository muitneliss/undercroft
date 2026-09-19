// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.

import { describe, expect, test as it } from "bun:test";
import { decodeBase64Url } from "./base64.ts";

describe("decodeBase64Url", () => {
  it("decodes Gmail's padding-free base64url exactly", () => {
    // Gmail omits padding and uses `-`/`_`. This is the shape `body.data` actually arrives
    // in, so the test carries it rather than a padded string that would pass either way.
    const bytes = decodeBase64Url("JVBERi0xLjcKJSVFT0YK");

    expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.7\n%%EOF\n");
  });

  it("the url alphabet decodes to the bytes the standard alphabet would not", () => {
    // `--_-` is base64url for the same bits standard base64 writes `++/+`. These three
    // bytes are only reachable through the url alphabet, so decoding with the wrong one is
    // the silent corruption this function exists to prevent.
    expect([...decodeBase64Url("--_-")]).toEqual([0xfb, 0xef, 0xfe]);
  });

  it("padding is accepted when a provider sends it", () => {
    expect([...decodeBase64Url("QQ==")]).toEqual([0x41]);
  });

  it("empty input is empty output, not an error", () => {
    // An attachment part with no data is a real Gmail response, not a fault.
    expect(decodeBase64Url("")).toHaveLength(0);
  });

  it("a non-base64url payload raises rather than decoding to something", () => {
    // The firing side. Node's decoder SKIPS characters outside the alphabet rather than
    // refusing, so an HTML error page would otherwise decode to plausible-looking bytes and
    // be stored as a PDF nobody can open.
    expect(() => decodeBase64Url("<html>not a token</html>")).toThrow(RangeError);
  });

  it("standard base64's + and / are refused, because they are the corruption case", () => {
    expect(() => decodeBase64Url("a+b/c")).toThrow(RangeError);
  });
});
