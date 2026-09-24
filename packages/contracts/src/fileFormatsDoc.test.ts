/**
 * `docs/reference/file-formats.md` describes every format the connection picker offers, with
 * the specification link and reading level the catalogue records.
 *
 * The page is the reference an admin and an agent read to learn what a chosen type will yield,
 * and the issue that asked for it asked for exactly this promise: every offered format, one
 * section each, none missing. A new format added to `FILE_FORMATS` without a section fails
 * here, and so does a section whose link or level has drifted from the catalogue.
 */

import { expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FILE_FORMATS } from "./index.ts";

const PAGE = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "reference", "file-formats.md"),
  "utf8",
);
const SECTIONS = PAGE.split("\n### ").slice(1);

it("gives every offered format exactly one section, with its link and reading level", () => {
  for (const format of FILE_FORMATS) {
    const sections = SECTIONS.filter((section) =>
      section.includes(`- Choice: \`${format.choice}\`\n`),
    );
    expect({ choice: format.choice, sections: sections.length }).toEqual({
      choice: format.choice,
      sections: 1,
    });
    expect(sections[0]).toContain(`- Specification: <${format.spec}>`);
    expect(sections[0]).toContain(`- Reads: \`${format.reads}\``);
  }
});

it("describes no format the picker does not offer", () => {
  expect(SECTIONS).toHaveLength(FILE_FORMATS.length);
});
