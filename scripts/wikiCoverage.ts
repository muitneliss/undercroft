/**
 * The wiki's coverage and provenance gate, owned by this repo.
 *
 * WHY THIS EXISTS AND IS NOT `wiki check`. The Ymir CLI has a `check` command that does
 * this and more, and it is the right tool at a developer's terminal. It cannot be the gate:
 * it is a 64 MB Mach-O arm64 binary living in a machine-local skill directory
 * (`~/.agents/skills/ymir/wiki-cli/bin/wiki`), it is published to no registry, and there is
 * no Linux build. CI runs `ubuntu-24.04`. So `run: wiki check` in a workflow is not a thing
 * that can work, and the alternative -- vendoring an arch-specific binary a third of the
 * size of the repo -- is worse than reimplementing the two findings that matter.
 *
 * Those two are not hypothetical. ADR 0012 (Biome) landed in #33 and ADR 0014 landed in #36,
 * both with no wiki page at all, and nobody noticed until somebody ran the CLI by hand
 * weeks later. That is the exact shape of a check that exists but does not gate.
 *
 * WHAT IT CHECKS, and each one is a way the wiki has drifted or could:
 *
 *   uncovered    an in-scope file with no source page. The failure that actually happened.
 *   stale        a page whose `source_hash` no longer matches its file. The summary now
 *                describes a document that has since been edited, which is worse than no
 *                page: it is a confident answer that is out of date.
 *   dangling     a page pointing at a file that no longer exists. This is one `git mv` away
 *                at any time -- renumbering ADR 0013 to 0014 would have done it, had the
 *                page existed yet.
 *   duplicated   two pages claiming the same file, so a reader gets whichever they find.
 *   out-of-scope a page claiming a file `tracked.yaml` does not cover, which means either
 *                the scope shrank or the page was ingested from somewhere it should not be.
 *   unverifiable a page with a source but no readable `source_hash`, so whether it is stale
 *                cannot be answered. Reported rather than skipped: "no evidence" is not
 *                "pass", and a gate that silently passes what it could not check is the
 *                failure this whole file exists to prevent.
 *
 * It deliberately does NOT reimplement the rest of `wiki check` -- link validity, orphan
 * notes, index freshness, schema shape. Those are the CLI's job and it does them better;
 * duplicating them here would create a second, worse definition of a valid wiki. This gate
 * answers one question: does every document the wiki promised to cover still have an
 * accurate page. `wiki validate` remains the local tool for the rest.
 *
 * Hashing is plain sha256 over the file's bytes, which is what the CLI records.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { parse } from "yaml";

export type FindingKind =
  | "uncovered"
  | "stale"
  | "dangling"
  | "duplicated"
  | "out-of-scope"
  | "unverifiable";

export interface Finding {
  kind: FindingKind;
  /** The repo-relative path the finding is about: a source document, or a wiki page. */
  path: string;
  message: string;
  /** What a person should do about it. Every finding names its own fix. */
  remedy: string;
}

interface Scope {
  include: string[];
  exclude: string[];
}

/** `tracked.yaml`'s declared scope. Absent file means the wiki promises nothing. */
function readScope(root: string): Scope {
  const file = join(root, "wiki", "tracked.yaml");
  if (!existsSync(file)) {
    return { include: [], exclude: [] };
  }
  // Through a real parser, never a regex. A hand-rolled reader that silently returns an
  // empty include list turns this whole gate green while checking nothing, which is the
  // one failure mode a gate must not have.
  const doc = parse(readFileSync(file, "utf8")) as Partial<Scope> | null;
  return {
    include: doc?.include ?? [],
    exclude: doc?.exclude ?? [],
  };
}

/** Every repo file the wiki has promised to cover, repo-relative and sorted. */
export function inScopeFiles(root: string): string[] {
  const { include, exclude } = readScope(root);
  const excluded = exclude.map((pattern) => new Bun.Glob(pattern));
  const found = new Set<string>();

  for (const pattern of include) {
    for (const hit of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) {
      const path = hit.replaceAll("\\", "/");
      if (!excluded.some((glob) => glob.match(path))) {
        found.add(path);
      }
    }
  }

  return [...found].sort();
}

interface Page {
  /** Repo-relative path of the wiki page itself. */
  page: string;
  sourcePath: string | null;
  sourceHash: string | null;
}

/**
 * The frontmatter the CLI injects, read back.
 *
 * Only `source_path` and `source_hash` are consumed. A page with neither is a note or a
 * hand-authored page, not a claim about a tracked file, and is passed over rather than
 * reported -- this gate has no opinion about pages that are not tracking anything.
 */
function readPages(root: string): Page[] {
  const dir = join(root, "wiki", "sources");
  if (!existsSync(dir)) {
    return [];
  }

  const pages: Page[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) {
      continue;
    }
    const text = readFileSync(join(dir, name), "utf8");
    const end = text.indexOf("\n---", 4);
    if (!text.startsWith("---\n") || end === -1) {
      continue;
    }
    const front = parse(text.slice(4, end)) as Record<string, unknown> | null;
    const sourcePath = front?.source_path;
    const sourceHash = front?.source_hash;
    pages.push({
      page: `wiki/sources/${name}`,
      sourcePath: typeof sourcePath === "string" ? sourcePath : null,
      sourceHash: typeof sourceHash === "string" ? sourceHash : null,
    });
  }
  return pages;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Audit one repository checkout. Pure: it reads and returns findings, and writes nothing.
 *
 * Returned findings are sorted by kind then path so the output is stable between runs --
 * a gate whose message reorders itself produces diffs nobody can read.
 */
export function auditWiki(root: string): Finding[] {
  const findings: Finding[] = [];
  const scoped = new Set(inScopeFiles(root));
  const pages = readPages(root).filter((page) => page.sourcePath !== null);
  const claims = new Map<string, string[]>();

  for (const page of pages) {
    const claimed = page.sourcePath ?? "";
    claims.set(claimed, [...(claims.get(claimed) ?? []), page.page]);

    const absolute = join(root, claimed);
    if (!existsSync(absolute)) {
      findings.push({
        kind: "dangling",
        path: page.page,
        message: `claims ${claimed}, which does not exist`,
        remedy: `the file moved or was deleted: re-ingest at its new path, or run: wiki remove --title "<title>"`,
      });
      continue;
    }

    if (!scoped.has(claimed)) {
      findings.push({
        kind: "out-of-scope",
        path: page.page,
        message: `claims ${claimed}, which wiki/tracked.yaml does not cover`,
        remedy: "widen include in wiki/tracked.yaml, or remove the page",
      });
    }

    // A page that records no readable digest is REPORTED, not passed over. There is no
    // evidence its summary still matches its document, and "no evidence" is not "pass" --
    // that is rule 2 in CLAUDE.md, and skipping the comparison here would have been the
    // harness quietly breaking the rule it exists to enforce.
    if (page.sourceHash === null) {
      findings.push({
        kind: "unverifiable",
        path: page.page,
        message: `claims ${claimed} but records no readable source_hash`,
        remedy: `re-ingest so the digest is written: wiki ingest --source ${claimed} --title "<title>"`,
      });
    } else if (sha256(absolute) !== page.sourceHash) {
      findings.push({
        kind: "stale",
        path: claimed,
        message: `has changed since ${page.page} was written`,
        remedy: `read the file, then run: wiki ingest --source ${claimed} --title "<title>"`,
      });
    }
  }

  for (const [claimed, byPages] of claims) {
    if (byPages.length > 1) {
      findings.push({
        kind: "duplicated",
        path: claimed,
        message: `is claimed by ${byPages.length} pages: ${byPages.join(", ")}`,
        remedy: 'remove all but one with: wiki remove --title "<title>"',
      });
    }
  }

  for (const file of scoped) {
    if (!claims.has(file)) {
      findings.push({
        kind: "uncovered",
        path: file,
        message: "is in scope but has no wiki source page",
        remedy: `read the file, then run: wiki ingest --source ${file} --title "<title>"`,
      });
    }
  }

  return findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
}

/**
 * Run directly for a readable report: `bun run wiki:check`.
 *
 * The gate itself is `scripts/wikiCoverage.test.ts`, which runs inside `bun test` and so
 * inside `bun run verify` and CI -- one definition of the gate, per CLAUDE.md. This entry
 * point exists because a person who has just been failed by that test wants the list, not
 * an assertion diff.
 */
if (import.meta.main) {
  const root = resolve(import.meta.dirname, "..");
  const findings = auditWiki(root);

  for (const finding of findings) {
    process.stdout.write(`${finding.kind}: ${finding.path} ${finding.message}\n`);
    process.stdout.write(`  remedy: ${finding.remedy}\n`);
  }

  if (findings.length === 0) {
    process.stdout.write(
      `wiki coverage ok (${String(inScopeFiles(root).length)} files in scope)\n`,
    );
  }

  process.exitCode = findings.length === 0 ? 0 : 1;
}
