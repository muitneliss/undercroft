/**
 * What the operator table promises: text can contain and cannot be bounded, a number or
 * an instant can, a boolean only compares, and a type this does not know offers nothing
 * rather than an operator that would fail at run time.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { arityOf, opLabel, opsFor } from "./biOps.ts";

const vi = translatorFor("vi");

describe("opsFor", () => {
  it("offers each family what Postgres can do with it, and an unknown type nothing", () => {
    expect(opsFor("text")).toContain("contains");
    expect(opsFor("text")).not.toContain("between");
    expect(opsFor("numeric")).toContain("between");
    expect(opsFor("timestamp with time zone")).toContain("gte");
    expect(opsFor("boolean")).toEqual(["eq", "neq", "is_null", "not_null"]);
    expect(opsFor("jsonb")).toEqual([]);
  });

  it("names each operator's arity, in the reader's words", () => {
    expect(arityOf("between")).toBe("two");
    expect(arityOf("in")).toBe("many");
    expect(arityOf("is_null")).toBe("none");
    expect(arityOf("gt")).toBe("one");
    expect(opLabel(vi, "contains")).toBe("chứa");
  });
});
