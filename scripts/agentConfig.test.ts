/**
 * Claude Code and Codex read one agent configuration, each in its own format.
 *
 * `.claude/` owns every word; what Codex reads is symlinks and pointers into it (CLAUDE.md,
 * "Codex"). A missing pointer fails nothing -- the skill or the agent is simply absent for one
 * of the two, and neither agent can tell -- so this suite is what notices.
 *
 * It also pins the rule frontmatter key. Claude Code reads `paths:` and nothing else from a
 * rule, and a rule whose only scope is under any other key loads for every file without a
 * word of warning. That is how all thirteen rules came to be unconditional while their
 * frontmatter said `globs:`.
 *
 * The wiki hook is the one guard here, so it is pinned from both sides, once per agent: the two
 * name the file they are about to write in different shapes, and a shape the hook cannot read
 * is a hook that fails open.
 *
 * No Docker, no network: it reads the repo and runs the hook under `node`, as both agents do.
 */

import { expect, test as it } from "bun:test";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const REPO = join(import.meta.dirname, "..");
const HOOK = join(REPO, ".claude", "hooks", "block-wiki-edits.mjs");

function namesIn(dir: string, suffix = ""): string[] {
  return readdirSync(join(REPO, dir))
    .filter((name) => name.endsWith(suffix))
    .sort();
}

function frontmatter(file: string): Record<string, unknown> {
  const match = /^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(readFileSync(join(REPO, file), "utf8"));
  return match?.groups?.yaml === undefined ? {} : parse(match.groups.yaml);
}

interface ToolCall {
  readonly cwd?: string;
  readonly hook_event_name?: string;
  readonly tool_input: { readonly command?: string; readonly file_path?: string };
  readonly tool_name: string;
}

function verdict(call: ToolCall): string {
  const run = Bun.spawnSync(["node", HOOK], { stdin: Buffer.from(JSON.stringify(call)) });
  expect(run.exitCode).toBe(0);
  const out = run.stdout.toString();
  return out === "" ? "allow" : JSON.parse(out).hookSpecificOutput.permissionDecision;
}

function codexPatch(...files: string[]): ToolCall {
  const body = files.map((file) => `*** Update File: ${file}\n@@\n-old\n+new`).join("\n");
  return {
    cwd: REPO,
    hook_event_name: "PreToolUse",
    tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch\n` },
    tool_name: "apply_patch",
  };
}

it("every rule file is in CLAUDE.md's index, which is how a non-Claude agent finds it", () => {
  const index = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
  const indexed = [...index.matchAll(/^\| `(?<rule>[a-z0-9-]+\.md)` /gmu)]
    .flatMap((row) => row.groups?.rule ?? [])
    .sort();

  expect(indexed).toEqual(namesIn(".claude/rules", ".md"));
});

it("a rule's frontmatter holds no key Claude Code would ignore", () => {
  const ignored = namesIn(".claude/rules", ".md").flatMap((rule) =>
    Object.keys(frontmatter(`.claude/rules/${rule}`))
      .filter((key) => key !== "paths" && key !== "description")
      .map((key) => `${rule}: ${key}`),
  );

  expect(ignored).toEqual([]);
});

it("Codex sees every Claude skill as the same directory, not a copy", () => {
  const skills = namesIn(".claude/skills");

  expect(namesIn(".agents/skills")).toEqual(skills);
  expect(skills.map((name) => realpathSync(join(REPO, ".agents", "skills", name)))).toEqual(
    skills.map((name) => realpathSync(join(REPO, ".claude", "skills", name))),
  );
});

it("every Claude agent has a Codex agent with its name and description", () => {
  const claude = namesIn(".claude/agents", ".md").map((file) => {
    const { name, description } = frontmatter(`.claude/agents/${file}`);
    return { description, name };
  });
  const codex = namesIn(".codex/agents", ".toml").map((file) => {
    const toml = Bun.TOML.parse(readFileSync(join(REPO, ".codex", "agents", file), "utf8"));
    const { name, description } = toml as Record<string, unknown>;
    return { description, name };
  });

  expect(codex).toEqual(claude);
});

it("the hook refuses Claude Code's edit of a CLI-owned wiki page", () => {
  const call = { tool_input: { file_path: join(REPO, "wiki", "index.md") }, tool_name: "Edit" };

  expect(verdict(call)).toBe("deny");
});

it("the hook lets Claude Code write the wiki's raw inbox", () => {
  const call = { tool_input: { file_path: join(REPO, "wiki", "raw", "a.md") }, tool_name: "Write" };

  expect(verdict(call)).toBe("allow");
});

it("the hook refuses a Codex patch that names a wiki note by a relative path", () => {
  expect(verdict(codexPatch("docs/adr/0001-a.md", "wiki/notes/a.md"))).toBe("deny");
});

it("the hook lets a Codex patch through when it touches no CLI-owned page", () => {
  expect(verdict(codexPatch("docs/adr/0001-a.md", "wiki/SCHEMA.md"))).toBe("allow");
});
