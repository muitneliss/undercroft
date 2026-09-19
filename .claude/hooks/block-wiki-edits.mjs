#!/usr/bin/env node

// A Claude Code hook: the agent harness runs it as a Node script, handing it the tool call on
// stdin and reading the verdict from stdout. It is linted rather than ignored because a broken
// hook fails OPEN -- hand-edits would then reach CLI-owned wiki pages silently.

import { readFileSync } from "node:fs";
import process from "node:process";

const input = JSON.parse(readFileSync(0, "utf8"));
const file = input?.tool_input?.file_path ?? "";

const norm = file.replaceAll("\\", "/");

const blocked =
  /\/wiki\/sources\//u.test(norm) ||
  /\/wiki\/notes\//u.test(norm) ||
  /\/wiki\/index\.md$/u.test(norm) ||
  /\/wiki\/log\.md$/u.test(norm);

if (blocked) {
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
