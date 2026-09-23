import { describe, expect, test as it } from "bun:test";
import { types } from "pg";
import { pinTypeParsers } from "./pool.ts";

const NUMERIC_OID = 1700;
const INT8_OID = 20;

/**
 * `pg`'s own defaults already hand both types back as text, so asserting the parser after an
 * import proves nothing: it would pass with `pinTypeParsers` emptied. What the pin exists for
 * is a default that has moved, so each test installs one first -- a parser that answers
 * something other than the text it was given -- and asserts the pin takes it back.
 */
describe("money-shaped types come back from pg as the text Postgres sent", () => {
  it("numeric is its own digits, whatever default was installed before", () => {
    types.setTypeParser(NUMERIC_OID, () => "a default that moved");

    pinTypeParsers();

    expect(types.getTypeParser(NUMERIC_OID)("8500.0001")).toBe("8500.0001");
  });

  it("an int8 past 2^53 keeps every digit", () => {
    // 2^53 + 1 is the first integer a double cannot hold: as a float it reads back as ...992.
    types.setTypeParser(INT8_OID, () => "a default that moved");

    pinTypeParsers();

    expect(types.getTypeParser(INT8_OID)("9007199254740993")).toBe("9007199254740993");
  });
});
