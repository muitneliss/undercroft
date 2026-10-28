/**
 * A kept call's body as the account page prints it (ADR 0151): indented without being re-parsed,
 * so a number past a double and a string holding brackets print exactly as the agent sent them,
 * and a body cut at the cap or not JSON prints as stored.
 */

import { describe, expect, test as it } from "bun:test";

import { indentJson, printedBody } from "@/lib/calls.ts";

describe("printedBody", () => {
  it("indents a whole body without touching a number a double cannot hold", () => {
    const stored = '{"id":12345678901234567890,"tags":[],"q":"a, {b}: [c]","n":[1,2]}';
    expect(printedBody(stored, false)).toEqual({
      text: [
        "{",
        '  "id": 12345678901234567890,',
        '  "tags": [],',
        '  "q": "a, {b}: [c]",',
        '  "n": [',
        "    1,",
        "    2",
        "  ]",
        "}",
      ].join("\n"),
      indented: true,
    });
  });

  it("keeps an escaped quote inside its string", () => {
    expect(indentJson('{"sql":"select \\"x\\", 1"}')).toBe('{\n  "sql": "select \\"x\\", 1"\n}');
  });

  it("prints a body cut at the cap exactly as stored", () => {
    const cut = '{"rows":[["Thành phố';
    expect(printedBody(cut, true)).toEqual({ text: cut, indented: false });
  });

  it("prints what is not balanced JSON exactly as stored", () => {
    expect(printedBody("[unserialisable]", false)).toEqual({
      text: "[unserialisable]",
      indented: false,
    });
    expect(printedBody('{"a":[1}', false).indented).toBe(false);
    expect(printedBody('{"a":"open', false).indented).toBe(false);
  });
});
