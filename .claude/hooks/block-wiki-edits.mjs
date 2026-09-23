#!/usr/bin/env node

// A PreToolUse hook for BOTH agents: Claude Code runs it from `.claude/settings.json`, Codex from
// `.codex/hooks.json`. Each hands it the tool call on stdin and reads the verdict from stdout, in
// the same `hookSpecificOutput` shape. It is linted rather than ignored because a broken hook
// fails OPEN -- hand-edits would then reach CLI-owned wiki pages silently.
//
// The two agents name the file differently. Claude Code's Write/Edit carry one absolute
// `file_path`. Codex's `apply_patch` carries the whole patch as `command`, whose `*** ... File:`
// headers name every file it touches, relative to the session's `cwd` -- and the patterns below
// only match an absolute path, so a relative one left unresolved would pass unnoticed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const PATCH_TARGET = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (?<path>.+)$/gmu;
const CLI_OWNED = [
  /\/wiki\/sources\//u,
  /\/wiki\/notes\//u,
  /\/wiki\/index\.md$/u,
  /\/wiki\/log\.md$/u,
];

const input = JSON.parse(readFileSync(0, "utf8"));
const toolInput = input?.tool_input ?? {};

function targets() {
  if (typeof toolInput.file_path === "string") {
    return [toolInput.file_path];
  }
  if (typeof toolInput.command !== "string") {
    return [];
  }
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  return [...toolInput.command.matchAll(PATCH_TARGET)].map((match) =>
    resolve(cwd, match.groups.path.trim()),
  );
}

function isCliOwned(file) {
  const norm = file.replaceAll("\\", "/");
  return CLI_OWNED.some((pattern) => pattern.test(norm));
}

if (targets().some(isCliOwned)) {
  process.stdout.write(
    JSON.stringify(
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "Wiki docs are CLI-managed. Use the Ymir wiki CLI (ingest/note/index/log) instead of editing wiki files directly. Allowed direct edits: wiki/raw/** and wiki/SCHEMA.md.",
        },
      },
      null,
      2,
    ),
  );
}
process.exit(0);
