/**
 * `readSkills`: what makes a directory a skill `/mcp` may serve, and what it serves.
 *
 * Each refusal is pinned from both sides against a real directory tree written to a temporary
 * folder, and the manifest is checked against the bytes on disk -- the one property a host
 * verifies before it loads anything (SEP-2640).
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readSkills, SKILL_FILE_LIMIT, SkillsRefused } from "./skills.ts";

let root: string;

function write(path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function SKILL(name: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: Build a model.\n${extra}---\n\n# ${name}\n\nRead \`references/a.md\`.\n`;
}

function refusal(): readonly string[] {
  try {
    readSkills(root);
  } catch (error) {
    if (error instanceof SkillsRefused) {
      return error.problems;
    }
    throw error;
  }
  throw new Error("expected the tree to be refused");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "undercroft-skills-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a valid tree", () => {
  it("is read into one entry per skill, with a manifest of every file", () => {
    write("model-builder/SKILL.md", SKILL("model-builder", "metadata:\n  owner: data\n"));
    write("model-builder/references/a.md", "# A\n");

    const [skill, ...rest] = readSkills(root);

    expect(rest).toEqual([]);
    expect(skill?.uri).toBe("skill://model-builder/SKILL.md");
    expect(skill?.frontmatter).toEqual({
      name: "model-builder",
      description: "Build a model.",
      metadata: { owner: "data" },
    });
    expect(skill?.files.map((file) => file.uri)).toEqual([
      "skill://model-builder/SKILL.md",
      "skill://model-builder/references/a.md",
    ]);
  });

  it("digests and sizes each file from the bytes it will serve", () => {
    write("model-builder/SKILL.md", SKILL("model-builder"));
    write("model-builder/references/a.md", "# Ä\n");

    const [skill] = readSkills(root);
    const file = skill?.files.find((f) => f.uri.endsWith("a.md"));
    const bytes = readFileSync(join(root, "model-builder/references/a.md"));

    expect(file?.size).toBe(bytes.byteLength);
    expect(file?.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(file?.content).toEqual({ text: "# Ä\n" });
    expect(file?.mimeType).toBe("text/markdown");
  });

  it("orders skills by name, whatever order the disk lists them in", () => {
    write("zeta/SKILL.md", SKILL("zeta"));
    write("alpha/SKILL.md", SKILL("alpha"));

    expect(readSkills(root).map((skill) => skill.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("refusals", () => {
  it("a name that is not its directory's is refused", () => {
    write("model-builder/SKILL.md", SKILL("modelbuilder"));
    expect(refusal()).toEqual([
      "model-builder: frontmatter name is modelbuilder, not its directory's name",
    ]);
  });

  it("a name outside the Agent Skills grammar is refused", () => {
    write("Model--Builder/SKILL.md", SKILL("Model--Builder"));
    expect(refusal()[0]).toContain("lowercase letters, digits and single hyphens");
  });

  it("a missing or empty description is refused", () => {
    write("model-builder/SKILL.md", "---\nname: model-builder\n---\n\n# x\n");
    expect(refusal()).toEqual(["model-builder: description must be 1 to 1024 characters"]);
  });

  it("a SKILL.md with no frontmatter is refused", () => {
    write("model-builder/SKILL.md", "# no frontmatter\n");
    expect(refusal()).toEqual(["model-builder: SKILL.md must begin with YAML frontmatter"]);
  });

  it("a directory with no SKILL.md is refused", () => {
    write("model-builder/references/a.md", "# A\n");
    expect(refusal()).toEqual(["model-builder: has no SKILL.md"]);
  });

  it("a skill over the file limit is refused", () => {
    write("model-builder/SKILL.md", SKILL("model-builder"));
    for (let index = 0; index < SKILL_FILE_LIMIT; index += 1) {
      write(`model-builder/references/f${String(index)}.md`, "x");
    }
    expect(refusal()[0]).toContain(`more than ${String(SKILL_FILE_LIMIT)} files`);
  });

  it("every problem is reported at once, not the first alone", () => {
    write("one/SKILL.md", SKILL("uno"));
    write("two/references/a.md", "x");
    expect(refusal()).toHaveLength(2);
  });
});
