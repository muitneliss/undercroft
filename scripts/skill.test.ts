/**
 * The `undercroft-cli` skill stays installable and points at the release it ships with.
 *
 * Both failures are silent anywhere else. A skill whose `name` differs from its directory is
 * not the skill `npx skills add ... --skill undercroft-cli` asks for. And the skill runs the
 * CLI from a pinned release URL: if release-please bumped the root version without bumping
 * the one in SKILL.md (its `extra-files`), every agent would keep running the last release's
 * CLI against this release's server, with nothing to say so. The CLI's own `package.json`
 * version is what names the tarball that URL fetches, so it is held to the same number.
 *
 * No network: it reads the files. `task ci:skill-check` is the network half.
 */

import { expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const REPO = join(import.meta.dirname, "..");
const SKILL_DIR = join(REPO, "skills", "undercroft-cli");
const SKILL = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");

function versionOf(file: string): string {
  return (JSON.parse(readFileSync(join(REPO, file), "utf8")) as { version: string }).version;
}

it("names itself after its directory, which is the name an install asks for", () => {
  const frontmatter = /^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(SKILL)?.groups?.yaml ?? "";
  const { name, description } = parse(frontmatter) as { name?: unknown; description?: unknown };

  expect(name).toBe("undercroft-cli");
  expect(typeof description).toBe("string");
});

// release-please bumps the pinned block (`extra-files`), so it is held to the release. The
// README pins nothing: it is an index, and a person's install lines live in the CLI runbook.
it("pins the CLI of the release it ships in", () => {
  const pinned =
    /<!-- x-release-please-start-version -->(?<block>[\s\S]*?)<!-- x-release-please-end -->/u.exec(
      SKILL,
    )?.groups?.block;
  const versions = [...(pinned ?? "").matchAll(/\d+\.\d+\.\d+/gu)].map(([version]) => version);

  // Exactly ONE mention, which the tag and the tarball's name both read through `$v`.
  // release-please's generic updater rewrites only the first version on a line, so the 1.20.0
  // release left `.../download/v1.20.0/undercroft-cli-1.19.1.tgz` -- a URL that 404s.
  expect(versions).toEqual([versionOf("package.json")]);
});

// The skill files bugs through `bug_report.yml`, naming its field ids in a prefilled URL and
// one of its options verbatim. Renaming either in the form would leave an agent sending a
// link whose fields arrive empty, or picking an option the form no longer has, with nothing
// to say so.
it("reports bugs through form fields and options that exist", () => {
  const form = parse(
    readFileSync(join(REPO, ".github", "ISSUE_TEMPLATE", "bug_report.yml"), "utf8"),
  ) as { body: { id?: string; attributes: { options?: unknown[] } }[] };
  const prefill = /issues\/new\?template=bug_report\.yml&(?<query>\S+)`/u.exec(SKILL)?.groups
    ?.query;
  const named = [...(prefill ?? "").matchAll(/&?(?<id>[\w-]+)=/gu)]
    .map((match) => match.groups?.id)
    .filter((id) => id !== "title");
  const options = form.body.flatMap((field) => field.attributes.options ?? []);

  expect(named.length).toBeGreaterThan(0);
  expect(form.body.map((field) => field.id)).toEqual(expect.arrayContaining(named));
  expect(options).toContain("CLI in agent mode (Claude Code, Codex or another agent)");
  expect(SKILL).toContain("`CLI in agent mode (Claude Code, Codex or another agent)`");
});

it("builds its tarball under the release's version", () => {
  expect(versionOf("apps/cli/package.json")).toBe(versionOf("package.json"));
});
