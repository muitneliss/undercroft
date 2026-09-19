/**
 * The wiki coverage gate, pinned from both sides.
 *
 * This file is the gate. `bun test` runs it, `bun run verify` runs `bun test`, and CI runs
 * `bun run verify` -- so the check fails on a developer's machine before it fails on a pull
 * request, which is the point of CLAUDE.md's "one definition of the gate". There is
 * deliberately no separate CI job: `compose` and `secrets` are separate because they need
 * Docker and git plumbing that do not belong in the offline tier, and this needs neither.
 *
 * Every guard gets the two tests `.claude/rules/tests.md` requires -- one where it fires and
 * one where it stays quiet -- against fixtures in a throwaway wiki in the system temp
 * directory. A guard with only the firing case is satisfied by an audit that always
 * complains, and a guard with only the quiet case by one that never does. The last test
 * runs the audit against THIS repository, which is the one that would have caught ADR 0012
 * and ADR 0014 arriving with no page.
 */

import { afterAll, expect, test as it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { auditWiki, type FindingKind } from "./wikiCoverage.ts";

const REPO = join(import.meta.dirname, "..");
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Build a throwaway checkout: `files` become real documents, `pages` become wiki source
 * pages. A page's hash is computed from the document it names unless the fixture overrides
 * it, so the honest case needs no hand-copied digests and the stale case is one flag.
 */
function fixture(
  files: Record<string, string>,
  pages: { source: string; hash?: string }[],
  include = "docs/**/*.md",
): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-gate-"));
  roots.push(root);

  mkdirSync(join(root, "wiki", "sources"), { recursive: true });
  writeFileSync(join(root, "wiki", "tracked.yaml"), `include:\n  - "${include}"\n`);

  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }

  for (const [index, page] of pages.entries()) {
    const hash =
      page.hash ??
      createHash("sha256")
        .update(files[page.source] ?? "")
        .digest("hex");
    writeFileSync(
      join(root, "wiki", "sources", `page-${String(index)}.md`),
      `---\ntitle: Page ${String(index)}\ntype: source\nsource_path: ${page.source}\nsource_hash: ${hash}\n---\n\n# Page ${String(index)}\n`,
    );
  }

  return root;
}

function kinds(root: string): FindingKind[] {
  return auditWiki(root).map((finding) => finding.kind);
}

it("passes a wiki whose every in-scope document has an accurate page", () => {
  const root = fixture({ "docs/adr/0001-a.md": "one\n" }, [{ source: "docs/adr/0001-a.md" }]);
  expect(auditWiki(root)).toEqual([]);
});

it("reports a document in scope that no page covers — the ADR 0012 and 0014 failure", () => {
  const root = fixture({ "docs/adr/0001-a.md": "one\n", "docs/adr/0002-b.md": "two\n" }, [
    { source: "docs/adr/0001-a.md" },
  ]);
  expect(kinds(root)).toEqual(["uncovered"]);
  expect(auditWiki(root)[0]?.path).toBe("docs/adr/0002-b.md");
});

it("reports a page whose document changed after it was written", () => {
  // A digest with letters in it, not `"0".repeat(64)`. An all-digit hash is parsed out of
  // the frontmatter as a NUMBER, which used to make this fixture exercise the unverifiable
  // path while claiming to test drift -- the test passed for the wrong reason.
  const root = fixture({ "docs/adr/0001-a.md": "edited since\n" }, [
    { source: "docs/adr/0001-a.md", hash: "deadbeef".repeat(8) },
  ]);
  expect(kinds(root)).toEqual(["stale"]);
});

it("reports a page that records no digest, rather than passing what it cannot verify", () => {
  const root = fixture({ "docs/adr/0001-a.md": "one\n" }, [{ source: "docs/adr/0001-a.md" }]);
  writeFileSync(
    join(root, "wiki", "sources", "page-0.md"),
    "---\ntitle: Page 0\ntype: source\nsource_path: docs/adr/0001-a.md\n---\n\n# Page 0\n",
  );
  expect(kinds(root)).toEqual(["unverifiable"]);
});

it("reports a page pointing at a document that no longer exists", () => {
  const root = fixture({ "docs/adr/0001-a.md": "one\n" }, [
    { source: "docs/adr/0001-a.md" },
    { source: "docs/adr/0013-renamed-away.md" },
  ]);
  expect(kinds(root)).toEqual(["dangling"]);
});

it("reports one document claimed by two pages", () => {
  const root = fixture({ "docs/adr/0001-a.md": "one\n" }, [
    { source: "docs/adr/0001-a.md" },
    { source: "docs/adr/0001-a.md" },
  ]);
  expect(kinds(root)).toEqual(["duplicated"]);
});

it("reports a page covering a document the declared scope excludes", () => {
  const root = fixture({ "docs/adr/0001-a.md": "one\n", "notes/loose.md": "loose\n" }, [
    { source: "docs/adr/0001-a.md" },
    { source: "notes/loose.md" },
  ]);
  expect(kinds(root)).toEqual(["out-of-scope"]);
});

it("ignores a wiki page that claims no document at all", () => {
  const root = fixture({ "docs/adr/0001-a.md": "one\n" }, [{ source: "docs/adr/0001-a.md" }]);
  writeFileSync(
    join(root, "wiki", "sources", "hand-written.md"),
    "---\ntitle: Hand Written\ntype: note\n---\n\n# Hand Written\n",
  );
  expect(auditWiki(root)).toEqual([]);
});

/**
 * The one that matters. Everything above proves the audit can tell the difference; this
 * proves the repository currently passes it, and is what fails a pull request that adds a
 * document to `docs/` without ingesting it, or edits one without re-ingesting.
 */
it("this repository's wiki covers every document it promised to", () => {
  expect(auditWiki(REPO)).toEqual([]);
});
