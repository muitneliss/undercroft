---
title: 'Runbook: Agent skills'
type: source
date: 2026-10-13
tags: []
source: docs/runbook/agent-skills.md
source_path: docs/runbook/agent-skills.md
source_hash: 73950dafcde0750a329550102a62b64cf77dd211fb5ba8b16b7861e2e9857483
ingested: 2026-10-13
---

# Runbook: Agent skills

How to install, use and add Undercroft's published Agent Skills; the decisions are [[ADR 0067: The published skills are one family, installed by npx skills and served by /mcp]]. The skills teach workflows; the agent carries them out through either door, the MCP tools at `/mcp` ([[Runbook: Connecting an agent over MCP]]) or the `undercroft` CLI ([[Runbook: The undercroft CLI]]).

**The skills.** `undercroft` is the entry: which door to use, how an operation is spelled on each, what a refusal means, what only the person can do, how to report a defect; read before any other. `undercroft-model-builder` turns data into an answer, a report or a model ([[ADR 0114 The Model Builder Finds Out What Is Needed Before It Builds Anything]]): it inventories what the tenant already has, finds out what the person needs, and picks the smallest change -- a look at the data, a question or dashboard over existing models, a change to a model or macro, or a new model. Nothing is written before the plan is approved; a model is checked with `models.check` and saved and built on two separate yeses. Both live in `skills/` at the repository root, the only copy.

**Installing.** `npx skills add muitneliss/undercroft` installs every skill; `--skill <name> --agent claude-code|codex -y` installs one without prompts, `-g` for every project. With MCP tools present the skills use them; otherwise the `undercroft` skill installs its pinned CLI release on first use. Moving from releases before 1.41: `npx skills remove undercroft-cli`, then `npx skills add muitneliss/undercroft`; the CLI's commands, error codes and the MCP tools are unchanged.

**Over MCP.** `/mcp` serves the same skills through the MCP Skills extension (`skills/list`, files at `skill://<name>/<path>`), declared only when it has skills to serve. As of September 2026 no Claude host reads them and ChatGPT reads a static snapshot, so Claude Code and Codex install with `npx skills`. `npx @modelcontextprotocol/inspector --cli <url>/mcp --transport http --header "Authorization: Bearer upat_…" --method skills/list --verify` checks a server: exit 0 conforms, 7 is a violation.

**Adding a workflow skill.** Name it for what a person wants, not a tool. Create `skills/<name>/SKILL.md` (`name` = directory, lowercase single-hyphen words; `description` at most 1024 chars saying when to use it); name every operation by procedure path in backticks; put occasional detail in `references/`; add it to the entry skill's `## Workflows`. `task ci:verify` fails on an operation the router lacks, a broken link, a workflow the entry skill does not name, an `sql` example `models.check` flags, or a model builder that stops naming a read discovery needs (lake, models, lineage, macros, seeds, questions, dashboards); `task ci:skill-check` (network) shows `npx skills` lists it, and fails on a listed skill not under `skills/`. A router rename fails the gate until the skill follows. A skill for working on this repository goes in `.claude/skills/` with `metadata.internal: true` in its frontmatter, because `npx skills` scans that directory too and hides only what is marked internal; `scripts/skills.test.ts` fails on an unmarked tracked `SKILL.md` outside `skills/`.

**When it goes wrong.** `npx skills add` lists nothing: invalid frontmatter or a name that differs from its directory (`task ci:verify` names which). No door: neither MCP tools nor a shell. `skills/list` unknown: the control plane serves no skills, and `mcp_skills_unloaded` at boot says why. The model builder stops at `WRITES_DISABLED` or `PERMISSION_DENIED`: by design -- saving and building a model need `admin`, saving a question or dashboard `member`, and each a write grant or a profile that allows writes. The model builder ends without a model: often by design, because a question, a change to an existing model or a look at the data answered the request.
