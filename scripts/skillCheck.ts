/**
 * Assert that `npx skills` finds every skill this repository publishes.
 *
 * `npx skills add muitneliss/undercroft` is how an agent gets them: the `undercroft` skill,
 * which reaches the platform over MCP or through the pinned CLI release, and each workflow
 * skill beside it. A frontmatter mistake does not fail any compiler; the skill is simply not
 * offered. This runs the real `skills` CLI over the working tree, as a user's would run over
 * GitHub, and expects every directory under `skills/` to be listed by its own name.
 *
 * The `skills` version is pinned (the latest on the day this was written), so a new release
 * of it cannot change what passes here without a change here. It needs the network to fetch
 * that package, which is why this is `task ci:skill-check` and not part of `ci:verify`.
 *
 * `--list` refuses `--json` in this version, so the listing is read as text: the colour and
 * cursor codes are stripped, and the skill's name must stand alone on a line.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";

const SKILLS_CLI = "skills@1.7.0";
const REPO = join(import.meta.dir, "..");
const SKILLS = readdirSync(join(REPO, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
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

const missing = SKILLS.filter((skill) => !names.includes(skill));

if (listed.exitCode === 0 && SKILLS.length > 0 && missing.length === 0) {
  process.stdout.write(`skill-check: ${SKILLS_CLI} lists ${SKILLS.join(", ")}\n`);
} else {
  process.stderr.write(`skill-check: ${SKILLS_CLI} did not list ${missing.join(", ")}\n${text}\n`);
  process.exitCode = 1;
}
