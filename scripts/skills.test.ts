/**
 * The published skills point at the release they ship with, and at a bug form that exists.
 *
 * What makes a skill valid, and whether every operation it names is one the router has, is
 * pinned beside the code that serves it: `apps/control-plane/src/publishedSkills.test.ts`,
 * through the same `readSkills` `/mcp` uses. This suite holds what only the release and the
 * repository's own files can say, and every failure here is silent anywhere else.
 *
 * The `undercroft` skill runs the CLI from a pinned release URL, in `references/cli.md`: if
 * release-please bumped the root version without bumping that one (its `extra-files`), every
 * agent would keep running the last release's CLI against this release's server, with
 * nothing to say so. The CLI's own `package.json` version is what names the tarball that URL
 * fetches, so it is held to the same number.
 *
 * No network: it reads the files. `task ci:skill-check` is the network half.
 */

import { expect, test as it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const REPO = join(import.meta.dirname, "..");
const SKILL_DIR = join(REPO, "skills", "undercroft");
const CLI = readFileSync(join(SKILL_DIR, "references", "cli.md"), "utf8");
const BUG = readFileSync(join(SKILL_DIR, "references", "reporting-a-bug.md"), "utf8");

function versionOf(file: string): string {
  return (JSON.parse(readFileSync(join(REPO, file), "utf8")) as { version: string }).version;
}

// release-please bumps the pinned block (`extra-files`), so it is held to the release. The
// README pins nothing: it is an index, and a person's install lines live in the CLI runbook.
it("pins the CLI of the release it ships in", () => {
  const pinned =
    /<!-- x-release-please-start-version -->(?<block>[\s\S]*?)<!-- x-release-please-end -->/u.exec(
      CLI,
    )?.groups?.block;
  const versions = [...(pinned ?? "").matchAll(/\d+\.\d+\.\d+/gu)].map(([version]) => version);

  // Exactly ONE mention, which the tag and the tarball's name both read through `$v`.
  // release-please's generic updater rewrites only the first version on a line, so the 1.20.0
  // release left `.../download/v1.20.0/undercroft-cli-1.19.1.tgz` -- a URL that 404s.
  expect(versions).toEqual([versionOf("package.json")]);
});

// The skill files bugs through `bug_report.yml`, naming its field ids in a prefilled URL and
// the option for each door verbatim. Renaming either in the form would leave an agent sending
// a link whose fields arrive empty, or picking an option the form no longer has, with nothing
// to say so.
it("reports bugs through form fields and options that exist", () => {
  const form = parse(
    readFileSync(join(REPO, ".github", "ISSUE_TEMPLATE", "bug_report.yml"), "utf8"),
  ) as { body: { id?: string; attributes: { options?: unknown[] } }[] };
  const prefill = /issues\/new\?template=bug_report\.yml&(?<query>\S+)`/u.exec(BUG)?.groups?.query;
  const named = [...(prefill ?? "").matchAll(/&?(?<id>[\w-]+)=/gu)]
    .map((match) => match.groups?.id)
    .filter((id) => id !== "title");
  const options = form.body.flatMap((field) => field.attributes.options ?? []);

  expect(named.length).toBeGreaterThan(0);
  expect(form.body.map((field) => field.id)).toEqual(expect.arrayContaining(named));
  for (const door of [
    "CLI in agent mode (Claude Code, Codex or another agent)",
    "MCP (claude.ai, Claude Desktop, Claude Code or another client)",
  ]) {
    expect(options).toContain(door);
    expect(BUG).toContain(`\`${door}\``);
  }
});

it("builds its tarball under the release's version", () => {
  expect(versionOf("apps/cli/package.json")).toBe(versionOf("package.json"));
});

// `npx skills add muitneliss/undercroft` scans far more than `skills/`: `.claude/skills/`,
// `.agents/skills/` and a dozen other agent directories. The skills this repo keeps for
// working on ITSELF live there, and every one of them was installed into users' agents
// beside the published ones until they were marked internal -- the skills CLI's own
// `metadata.internal`, which hides a skill unless `INSTALL_INTERNAL_SKILLS=1`. Every tracked
// SKILL.md outside `skills/` is therefore internal, whichever directory it sits in.
it("marks every skill outside skills/ internal, so npx skills does not publish it", () => {
  const tracked = spawnSync("git", ["ls-files", "-z", "--", ":(glob)**/SKILL.md"], {
    cwd: REPO,
    encoding: "utf8",
  }).stdout.split("\0");
  const unmarked = tracked
    .filter((path) => path !== "" && !path.startsWith("skills/"))
    .filter((path) => {
      const text = readFileSync(join(REPO, path), "utf8");
      const frontmatter = /^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(text)?.groups?.yaml ?? "";
      const { metadata } = (parse(frontmatter) ?? {}) as { metadata?: { internal?: unknown } };
      return metadata?.internal !== true;
    });

  expect(tracked.some((path) => path.startsWith(".claude/skills/"))).toBe(true);
  expect(unmarked).toEqual([]);
});
