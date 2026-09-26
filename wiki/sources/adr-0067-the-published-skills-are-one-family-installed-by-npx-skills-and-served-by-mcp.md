---
title: >-
  ADR 0067: The published skills are one family, installed by npx skills and
  served by /mcp
type: source
date: 2026-09-26
tags: []
source: docs/adr/0067-the-published-skills-are-one-family-over-both-doors.md
source_path: docs/adr/0067-the-published-skills-are-one-family-over-both-doors.md
source_hash: 502b3d8021463ef6654c96996a39c1234e62bb5f383e928b40254143f5ceefd5
ingested: 2026-09-26
---

# ADR 0067: The published skills are one family, installed by npx skills and served by /mcp

# ADR 0067: The published skills are one family, installed by npx skills and served by /mcp

Accepted 2026-09-26. Relates to [[ADR 0044: An agent reaches Undercroft as a caller]] (whose skill, `undercroft-cli`, it renames and widens), [[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]] (whose rejection of a separate MCP process and of stdio stands) and [[ADR 0061: An MCP client signs its person in, and draws two widgets]] (whose widgets the skills are served beside); none is superseded.

**Context.** The capability layer was already one thing: the CLI and `/mcp` are both built from `procedureManifest()`. The skill layer was one CLI-only skill whose named operations nothing checked. A handoff asked to separate capabilities (MCP) from workflows (skills), keep `skills/` the single copy distributed by `npx skills`, and validate a skill's tool references in CI; the request also asked for a skill that interviews a person and guides them to save a query as a dbt model, or build one, with guardrails. Measured against the repo: adopted the layering, the single copy and the CI check (inside `task ci:verify`); destructive metadata already existed (`EFFECTS` -> `destructiveHint`, `--yes`); rejected the stdio MCP package; took up "current skill text from the server" through the official MCP Skills extension instead of the CLI. That extension, `io.modelcontextprotocol/skills` (SEP-2640), was Final on 2026-09-26, with no Claude host consuming it yet.

**One family.** `skills/undercroft` is the entry: it picks a door (the `undercroft` MCP tools if present, else the CLI), states the naming rule (`models.check` = tool `models_check` = `undercroft models check`) and the rules both doors share; per-door detail sits in `references/cli.md` (install pin, envelope contract), `references/mcp.md` and `references/reporting-a-bug.md`. `undercroft-model-builder` is the first workflow skill: interview to a written brief, read the lake instead of guessing, draft from patterns, `models.check`, confirm before `models.save` (always `create: true`) and again before `models.build`, never delete, stop at a refusal; ten guardrails. Skills name operations by procedure path. The rename breaks `--skill undercroft-cli` only; CLI and MCP contracts are unchanged, so not a major release.

**Served by /mcp.** `/mcp` declares the extension and answers `skills/list`/`skills/get` (`resultType: "complete"`, `ttlMs` five minutes, `cacheScope: "public"`), each file at `skill://<name>/<path>` through `resources/read`. `apps/control-plane/src/skills.ts` reads `skills/` once at boot, as `widgets.ts` builds widgets; the image carries it (`COPY skills`); a failed read logs `mcp_skills_unloaded` and serves none, and the extension is declared only with a skill to serve. Digests and sizes come from the served bytes; UTF-8 is text, anything else base64. A read looks the URI up among manifest entries, never joining a path, so an unknown or climbing URI is -32602. Any grant may read a skill; the bearer is still required. `resources/list` keeps listing widgets only. `npx skills` stays primary because it reaches Claude Code and Codex today.

**The gate.** `readSkills` is the one definition of a valid skill (frontmatter `name`/`description`, Agent Skills name grammar equal to the directory, description 1-1024 chars, at most 512 files and 16 MiB). `apps/control-plane/src/publishedSkills.test.ts` reads the real tree through it and fails on a procedure path, CLI command or MCP tool the router lacks or does not offer over MCP, a link to a file the skill does not hold, a workflow the entry skill does not name, or an `sql` example `models.check` finds anything in. A reference counts only when its first segment is a router topic. `scripts/skills.test.ts` keeps the version pin and bug-form checks; `task ci:skill-check` asserts `npx skills` lists every directory under `skills/`.

**models.check.** A new read-effect procedure (a POST, like `bi.answer`) returning errors that are lexically certain (a semicolon; a write keyword, a data-modifying CTE included; `select ... into`; not a query; a declared raw table past `source()`; another model by schema or bare name rather than `ref()`; a `source()`/`ref()` naming nothing; a report question's `{{ name }}` parameter), warnings (no `deleted_at` when reading records, `coalesce(..., 0)`, top-level `limit`, unknown macro, a reference whose name is not written out, a test for an unmentioned column), and always what it cannot verify (compiles, payload keys, types, tests, function effects), worded in the caller's language. It lives in `packages/db/src/services/` (`jinja.ts` and `sqlLexer.ts` report facts; `sqlChecks.ts` and `modelCheck.ts` decide in `modelFindings.ts`'s vocabulary; sources read from `SOURCES_YML` via `dbtSources.ts`). It advises and never gates `models.save`, preserving the editor's save-a-draft promise, and is not the security boundary (the tenant dbt login's grants are). The report-parameter error exists because dbt renders an unknown Jinja name as an empty string, so a question saved as a model would build with its filter silently gone.

**Language.** Skills are instructions for an agent, in English; the i18n rule governs text the platform words for a person, and the skill relays those messages as they arrive.

**Rejected.** A separate stdio MCP package; skills as MCP prompts; CLI `skills list/get`; guardrails only in the skill; refusing `models.save` on an error; `directoryRead`; keeping the name `undercroft-cli`.

**Consequences.** One install (`npx skills add muitneliss/undercroft`) or one MCP connection gives the same workflows; renaming a procedure a skill names fails the gate until the skill follows; `undercroft-cli` installs move once; the web UI's Models editor does not show `models.check` findings yet.
