/**
 * Assert that `npx skills` finds the `undercroft-cli` skill in this repository.
 *
 * `skills/undercroft-cli/SKILL.md` is how an agent gets the CLI: `npx skills add
 * muitneliss/undercroft --skill undercroft-cli` installs it, and the skill runs the pinned
 * release. A frontmatter mistake does not fail any compiler; the skill is simply not offered.
 * This runs the real `skills` CLI over the working tree, as a user's would run over GitHub.
 *
 * The `skills` version is pinned (the latest on the day this was written), so a new release
 * of it cannot change what passes here without a change here. It needs the network to fetch
 * that package, which is why this is `task ci:skill-check` and not part of `ci:verify`.
 *
 * `--list` refuses `--json` in this version, so the listing is read as text: the colour and
 * cursor codes are stripped, and the skill's name must stand alone on a line.
 */

import { join } from "node:path";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";

const SKILLS_CLI = "skills@1.7.0";
const SKILL = "undercroft-cli";
const REPO = join(import.meta.dir, "..");
/** The listing's left gutter: Clack's `│` rail and the indent beside it. */
const GUTTER = /^[\s│]+/u;

const listed = Bun.spawnSync(["npx", "-y", SKILLS_CLI, "add", REPO, "--list"], {
  cwd: REPO,
  // npx needs the caller's PATH and npm settings; NO_COLOR only quiets the listing.
  env: { ...process.env, NO_COLOR: "1" },
  stdout: "pipe",
  stderr: "pipe",
});
const text = stripVTControlCharacters(`${listed.stdout.toString()}${listed.stderr.toString()}`);
const names = text.split("\n").map((line) => line.replace(GUTTER, "").trim());

if (listed.exitCode === 0 && names.includes(SKILL)) {
  process.stdout.write(`skill-check: ${SKILLS_CLI} lists ${SKILL}\n`);
} else {
  process.stderr.write(`skill-check: ${SKILLS_CLI} did not list ${SKILL}\n${text}\n`);
  process.exitCode = 1;
}
