/**
 * The repository's published skills, read once per process, for `/mcp` to serve. ADR 0067.
 *
 * `skills/` at the repository root is the one copy of every skill: `npx skills add` installs
 * it from GitHub, and `/mcp` serves it to a host that speaks the MCP Skills extension
 * (`io.modelcontextprotocol/skills`, SEP-2640). Neither holds a second copy -- this reads the
 * files the image carries (`COPY skills` in the control plane's Dockerfile), the same bytes a
 * release tagged.
 *
 * It is also the ONE definition of a valid skill. `scripts/skills.test.ts` reads the real
 * tree through `readSkills`, so a skill the gate accepts is a skill `/mcp` can serve, and the
 * rules cannot be written twice and drift:
 *
 * - `SKILL.md` begins with YAML frontmatter holding `name` and `description`;
 * - `name` is the Agent Skills grammar (lowercase letters, digits, single hyphens, at most 64)
 *   and equals its directory's name, which the extension requires of a served skill;
 * - `description` is 1 to 1024 characters;
 * - a skill holds at most 512 files and 16 MiB, the size every host must accept.
 *
 * Every file's digest and size are computed from the bytes it will be served as, because a
 * host verifies both before it loads a single line. A file that is valid UTF-8 is served as
 * text; anything else as base64, never as text with replacement characters in it.
 *
 * Here beside `main.ts`, like `widgets.ts`, because reading the disk is the composition
 * root's to do. A tree that fails is logged and answered with no skills: `/mcp` then declares
 * no extension and serves every tool exactly as before.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { describeError, type Logger } from "@undercroft/core";
import { parse } from "yaml";
import type { Skill, SkillContent, SkillFile } from "./handlers/mcpSkills.ts";

/** `skills/` at the repository root: where the image carries it, and where a checkout has it. */
export const SKILLS_ROOT = join(import.meta.dir, "..", "..", "..", "skills");

/** The most files and bytes one skill may hold: what every host must accept (SEP-2640). */
export const SKILL_FILE_LIMIT = 512;
export const SKILL_BYTE_LIMIT = 16 * 1024 * 1024;

const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FRONTMATTER = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---\r?\n/u;
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".txt": "text/plain",
};

/** A tree with something wrong in it; every problem is listed, not the first alone. */
export class SkillsRefused extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`the skills cannot be served:\n  ${problems.join("\n  ")}`);
    this.name = "SkillsRefused";
    this.problems = problems;
  }
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function contentOf(bytes: Uint8Array): SkillContent {
  try {
    return { text: UTF8.decode(bytes) };
  } catch {
    return { blob: Buffer.from(bytes).toString("base64") };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every file under `dir` as a `/`-separated relative path, dot-files left out. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => !path.split("/").some((part) => part.startsWith(".")))
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort(skillFirst);
}

/** `SKILL.md` before everything, then by path: the order a manifest lists them in. */
function skillFirst(a: string, b: string): number {
  if (a === "SKILL.md" || b === "SKILL.md") {
    return a === "SKILL.md" ? -1 : 1;
  }
  return a.localeCompare(b);
}

function fileOf(name: string, dir: string, path: string): SkillFile {
  const bytes = readFileSync(join(dir, path));
  return {
    uri: `skill://${name}/${path}`,
    mimeType: MIME_TYPES[extname(path)] ?? "application/octet-stream",
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    size: bytes.byteLength,
    content: contentOf(bytes),
  };
}

/** What is wrong with a frontmatter for the skill in `dirName`, as sentences. */
function frontmatterProblems(dirName: string, frontmatter: Record<string, unknown>): string[] {
  const { name, description } = frontmatter;
  const problems: string[] = [];
  if (typeof name !== "string" || !NAME.test(name) || name.length > MAX_NAME) {
    problems.push(
      `${dirName}: name must be lowercase letters, digits and single hyphens, at most ${String(MAX_NAME)} characters`,
    );
  } else if (name !== dirName) {
    problems.push(`${dirName}: frontmatter name is ${name}, not its directory's name`);
  }
  if (
    typeof description !== "string" ||
    description.length === 0 ||
    description.length > MAX_DESCRIPTION
  ) {
    problems.push(`${dirName}: description must be 1 to ${String(MAX_DESCRIPTION)} characters`);
  }
  return problems;
}

type Reading = { readonly skill: Skill } | { readonly problems: readonly string[] };

function readSkill(root: string, dirName: string): Reading {
  const dir = join(root, dirName);
  const paths = filesUnder(dir);
  if (!paths.includes("SKILL.md")) {
    return { problems: [`${dirName}: has no SKILL.md`] };
  }
  if (paths.length > SKILL_FILE_LIMIT) {
    return { problems: [`${dirName}: holds more than ${String(SKILL_FILE_LIMIT)} files`] };
  }
  const files = paths.map((path) => fileOf(dirName, dir, path));
  if (files.reduce((total, file) => total + file.size, 0) > SKILL_BYTE_LIMIT) {
    return { problems: [`${dirName}: holds more than ${String(SKILL_BYTE_LIMIT)} bytes`] };
  }
  const head = files[0]?.content;
  const yaml = head !== undefined && "text" in head ? FRONTMATTER.exec(head.text) : null;
  const frontmatter: unknown = yaml?.groups?.yaml === undefined ? null : parse(yaml.groups.yaml);
  if (!isRecord(frontmatter)) {
    return { problems: [`${dirName}: SKILL.md must begin with YAML frontmatter`] };
  }
  const problems = frontmatterProblems(dirName, frontmatter);
  if (problems.length > 0) {
    return { problems };
  }
  return { skill: { name: dirName, uri: `skill://${dirName}/SKILL.md`, frontmatter, files } };
}

/** Every skill under `root`, by name; throws `SkillsRefused` naming every problem found. */
export function readSkills(root: string): Skill[] {
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const readings = dirs.map((dir) => readSkill(root, dir));
  const problems = readings.flatMap((reading) => ("problems" in reading ? reading.problems : []));
  if (problems.length > 0) {
    throw new SkillsRefused(problems);
  }
  return readings.flatMap((reading) => ("skill" in reading ? [reading.skill] : []));
}

/** The skills under `root`, or none -- logged either way -- so `/mcp` never fails to boot. */
export function loadSkills(log?: Logger, root = SKILLS_ROOT): readonly Skill[] {
  try {
    const skills = readSkills(root);
    log?.info("mcp_skills_loaded", { skills: skills.map((skill) => skill.name).join(",") });
    return skills;
  } catch (error) {
    log?.error("mcp_skills_unloaded", describeError(error));
    return [];
  }
}
