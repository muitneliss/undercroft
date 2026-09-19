/**
 * The curated file types read as words in both languages; a custom MIME type keeps its own
 * shape, or is refused before it is sent anywhere.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import {
  CURATED_FILE_TYPES,
  describeFileType,
  isPlausibleMimeType,
  normalizeFileType,
} from "./fileTypes.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");

describe("describeFileType", () => {
  it("names every curated type in both languages, never as its raw MIME type", () => {
    for (const type of CURATED_FILE_TYPES) {
      expect(describeFileType(en, type)).not.toBe(type);
      expect(describeFileType(vi, type)).not.toBe(type);
    }
  });

  it("a type outside the curated list keeps its raw MIME type", () => {
    expect(describeFileType(en, "application/zip")).toBe("application/zip");
  });
});

describe("isPlausibleMimeType", () => {
  it("accepts a type/subtype shape and refuses anything else a form could carry", () => {
    expect(isPlausibleMimeType("image/png")).toBe(true);
    expect(isPlausibleMimeType("application/vnd.ms-excel")).toBe(true);
    expect(isPlausibleMimeType("notamimetype")).toBe(false);
    expect(isPlausibleMimeType("")).toBe(false);
    expect(isPlausibleMimeType("a/b/c")).toBe(false);
  });
});

describe("normalizeFileType", () => {
  it("trims and lowercases, so a typed-in entry matches what Google's APIs send", () => {
    expect(normalizeFileType("  Image/PNG  ")).toBe("image/png");
  });
});
