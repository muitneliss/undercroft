/**
 * "Nothing probes them today", pinned from both sides.
 *
 * `rawRecords.ts` ends its longest comment with a claim about the call graph: a caller that
 * lands records without documents writes no mark, and nothing probes those rows today, so the
 * answer such a caller would get -- "read it again" -- never has to be relied upon. That
 * reasoning is sound and this test does not argue with it.
 *
 * What the test pins is the word "today". The claim holds because `knownRecords` has exactly
 * one caller outside the suites, and nothing would turn red if a second one arrived. The
 * comment a few lines above it records what that costs: the ordering rule that made presence a
 * safe test was asserted over rows it was never true of, never recorded, and so could not be
 * checked -- and a run that died mid-flight left thousands of records every later run then
 * skipped. This sentence sits in the same state that one did: true, load-bearing, and kept by
 * nothing.
 *
 * So the caller set becomes a fact the suite holds rather than a habit. This is deliberately
 * NOT a ban. A second caller is allowed to exist; it just cannot arrive quietly. When one does,
 * this test fails, whoever added it reads the comment, and the comment is updated with them --
 * which is the whole point, because the comment is the thing that would otherwise go stale.
 *
 * Both directions, as `.claude/rules/tests.md` requires: the scan is run against the real tree
 * and against throwaway fixtures, one holding a second caller and one holding only the caller
 * that belongs. A scan that cannot find a planted caller proves nothing about the real tree.
 *
 * No Docker, no network.
 */

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const WORKER_SRC = join(REPO, "apps", "worker", "src");

/** The one caller that belongs, relative to `apps/worker/src`. */
const EXPECTED_CALLER = "services/google/harvest.ts";

/**
 * Files that import `knownRecords` from the repo it lives in, excluding suites.
 *
 * Import-site rather than call-site on purpose: a call can be spelled in ways a scan misses,
 * but the name has to cross a module boundary to be called at all, and that crossing is one
 * line. Matched against the specifier so a same-named export from somewhere else is not
 * counted.
 */
function callersOf(root: string): string[] {
  const found: string[] = [];
  for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: root, onlyFiles: true })) {
    if (file.endsWith(".test.ts")) {
      continue;
    }
    const body = readFileSync(join(root, file), "utf8");
    const imports = body.matchAll(
      /import\s*(?:type\s*)?\{(?<names>[^}]*)\}\s*from\s*"(?<specifier>[^"]+)"/gu,
    );
    for (const match of imports) {
      const names = match.groups?.names;
      const specifier = match.groups?.specifier;
      if (specifier === undefined || !specifier.endsWith("rawRecords.ts")) {
        continue;
      }
      if (names !== undefined && /\bknownRecords\b/u.test(names)) {
        found.push(file.replaceAll("\\", "/"));
        break;
      }
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
}

let project = "";

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "undercroft-known-records-"));

  function write(path: string, body: string): void {
    const target = join(project, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${body.trim()}\n`);
  }

  // Quiet: the caller that belongs, and three near misses that must not count.
  write(
    "quiet/services/google/harvest.ts",
    `
    import { knownRecords, type RecordProbe } from "../../repos/rawRecords.ts";
    export const held = knownRecords;
    export type Probe = RecordProbe;
  `,
  );
  write(
    "quiet/services/spec/resume.ts",
    `
    import { readCursor, writeCursor } from "../../repos/rawRecords.ts";
    export const cursor = readCursor ?? writeCursor;
  `,
  );
  write(
    "quiet/services/other/elsewhere.ts",
    `
    import { knownRecords } from "../../repos/somethingElse.ts";
    export const unrelated = knownRecords;
  `,
  );
  write(
    "quiet/services/google/harvest.test.ts",
    `
    import { knownRecords } from "../../repos/rawRecords.ts";
    export const inASuite = knownRecords;
  `,
  );

  // Fires: everything the quiet tree has, plus a second caller arriving on the spec path.
  for (const [path, body] of Object.entries({
    "fires/services/google/harvest.ts": `
      import { knownRecords } from "../../repos/rawRecords.ts";
      export const held = knownRecords;
    `,
    "fires/services/spec/resume.ts": `
      import { knownRecords } from "../../repos/rawRecords.ts";
      export const alsoHeld = knownRecords;
    `,
  })) {
    write(path, body);
  }
});

afterAll(() => {
  if (project !== "") {
    rmSync(project, { recursive: true, force: true });
  }
});

describe("the scan can tell a second caller from the one that belongs", () => {
  it("finds a caller planted on the spec path", () => {
    expect(callersOf(join(project, "fires"))).toEqual([
      "services/google/harvest.ts",
      "services/spec/resume.ts",
    ]);
  });

  it("counts only the caller that belongs when nothing else imports it", () => {
    expect(callersOf(join(project, "quiet"))).toEqual(["services/google/harvest.ts"]);
  });

  it("does not count a suite, another export, or a same name from elsewhere", () => {
    const quiet = callersOf(join(project, "quiet"));
    expect(quiet).not.toContain("services/google/harvest.test.ts");
    expect(quiet).not.toContain("services/spec/resume.ts");
    expect(quiet).not.toContain("services/other/elsewhere.ts");
  });
});

describe("nothing probes them today", () => {
  it("knownRecords has exactly one caller outside the suites", () => {
    expect(callersOf(WORKER_SRC)).toEqual([EXPECTED_CALLER]);
  });

  it("the comment that rests on that fact names this test, so the two move together", () => {
    const source = readFileSync(join(WORKER_SRC, "repos", "rawRecords.ts"), "utf8");
    expect(source).toContain("knownRecordsCallers.test.ts");
  });
});
