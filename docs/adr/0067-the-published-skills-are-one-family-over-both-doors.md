# 67. The published skills are one family, installed by `npx skills` and served by `/mcp`

- Status: Accepted
- Date: 2026-09-26
- Relates to: [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md), whose skill,
  `undercroft-cli`, this renames and widens; [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md),
  whose rejection of a separate MCP process and of stdio still stands; and
  [ADR 0061](0061-an-mcp-client-signs-its-person-in-and-draws-two-widgets.md), whose widgets
  the skills are served beside. None of the three is superseded.

## Context

An agent reaches Undercroft through two doors: the CLI (ADR 0044) and `/mcp` (ADR 0060). Both
are built from the one router manifest, `procedureManifest()`, with nothing written per tool,
so the capability layer was already one thing. The skill layer was not. There was one
published skill, `undercroft-cli`. It taught only the CLI, it was organised around
the tool rather than around what a person wants done, and nothing checked the operations it
named against the router.

The request was to unify the CLI, MCP and the skill, following a handoff that separates the
two layers: MCP owns the capabilities and a skill owns the workflows. It also asked for a
skill that interviews a person and guides them to save a query as a dbt model, or to build a
model of their own, with guardrails.

What the handoff proposes, measured against this repository:

| The handoff proposes                                                  | Here                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| MCP owns capabilities; skills own workflows, named for an intent      | Adopted                                                                       |
| `skills/` is the one copy, vendor-neutral, installed by `npx skills`  | Adopted; it already was the one copy                                          |
| Every tool a skill names is checked in CI                             | Adopted, inside `task ci:verify`, not as a separate `validate:skills`         |
| Destructive operations are modelled in metadata                       | Already so: `EFFECTS` gives `destructiveHint` over MCP and `--yes` in the CLI |
| An independently runnable MCP package, `npx @org/product-mcp` (stdio) | Rejected; ADR 0060's reasons stand                                            |
| Current skill text from the CLI, `product skills get`                 | Taken up over MCP instead, by the official extension; not in the CLI          |

On 2026-09-26 the official MCP Skills extension, `io.modelcontextprotocol/skills`
(SEP-2640), was Final. It lets a server serve Agent Skills: `skills/list` and `skills/get`
answer each skill's `SKILL.md` URI, its frontmatter and a manifest of every file with its
SHA-256 and size, and each file is read through `resources/read`. The extension's client
matrix listed no Claude host consuming it yet, ChatGPT and the MCP Inspector partially, and
Codex not at all.

## Decision

### One family of skills, one of them the entry

`skills/undercroft-cli` becomes `skills/undercroft`, a skill that works over either door. Its
`SKILL.md` chooses a door: the tools of an `undercroft` MCP server when the session has them,
otherwise the CLI. It states the one rule that spells an operation on each door. A procedure
path `models.check` is the tool `models_check` and the command `undercroft models check`.
It also keeps the rules that hold on both doors: read before you write, never guess an ID,
the shared refusal codes, and what only the person can do. What belongs to one door moves to
`references/`:

- `cli.md` holds the install pin and the envelope contract;
- `mcp.md` holds grants, results and refusals over MCP;
- `reporting-a-bug.md` holds bug filing, which picks the bug form's option for the door in use.

A workflow is its own skill beside it, named for what a person wants. The first is
`undercroft-model-builder`. It interviews the person to a written brief and reads the lake
instead of guessing, drafts from patterns, runs `models.check`, and asks before it saves and
again before it builds. Ten guardrails hold for the whole workflow. Skills name an operation
by its procedure path, so a skill reads the same whichever door carries it out.

The rename breaks `npx skills add ... --skill undercroft-cli`. The CLI's commands and the MCP
tools do not change, so this is not a major release; `docs/runbook/agent-skills.md` says how
to move over.

### `/mcp` serves the same files, through the official extension

`/mcp` declares `io.modelcontextprotocol/skills` and answers `skills/list` and `skills/get`
with `resultType: "complete"`, a five-minute `ttlMs` and `cacheScope: "public"`. The content
is the public repository's, and it is the same for every caller. Each file is served at
`skill://<name>/<path>`.

- `apps/control-plane/src/skills.ts` reads `skills/` once at boot, as `widgets.ts` builds the
  widgets, and the image carries it (`COPY skills`). A tree that fails to read is logged and
  answered with no skills; the extension is then not declared and every tool is served as
  before. The extension is declared only when there is a skill to serve.
- Every digest and size is computed from the bytes the file is served as. A file that is
  valid UTF-8 is served as text, anything else as base64.
- A read looks the URI up among the manifests' entries and never joins it onto a path, so an
  unknown or climbing URI is `-32602`.
- A skill is content, not an operation, so a read grant may read it. The bearer is still
  required, as for every `/mcp` request.
- `resources/list` goes on listing the widgets alone. The extension forbids treating a URI's
  scheme as what makes a skill, and a host finds a skill's files through its manifest.

`npx skills add` stays the primary way to install, because it reaches Claude Code and Codex
today. The extension reaches hosts that adopt it later, without a second copy.

### The gate reads the skills the server serves

`readSkills` in `skills.ts` is the one definition of a valid skill. `SKILL.md` must open with
frontmatter holding `name` and `description`. The name follows the Agent Skills grammar and
equals its directory's name. The description is 1 to 1024 characters. A skill holds at most
512 files and 16 MiB.

`apps/control-plane/src/publishedSkills.test.ts` reads the real `skills/` through that
function and fails the gate when any of these is true:

- a skill names a procedure path, a CLI command or an MCP tool that the router does not have,
  or does not offer over MCP;
- a link points to a file the skill does not hold;
- the entry skill does not name every workflow skill;
- an SQL example trips `models.check`, a warning included.

A reference is recognised only when its first segment is one of the router's own topics, so
`raw.records` in an SQL example is not read as one. The version pin and the bug form stay in
`scripts/skills.test.ts`, and `task ci:skill-check` asserts that `npx skills` lists every
directory under `skills/`.

### `models.check` is the model builder's guardrail, on the server

`models.check` is a new procedure. It reads a model's SQL and answers three things:

- **Errors** that are lexically certain. These are:
  - a semicolon;
  - a write keyword, a data-modifying CTE included;
  - `select ... into`;
  - a statement that is not a query;
  - a declared raw table read past `source()`;
  - another model read by its schema or by its bare name rather than `ref()`;
  - a `source()` or `ref()` naming nothing that exists;
  - a report question's `{{ name }}` parameter left in the SQL.
- **Warnings**: records read with no mention of `deleted_at`, `coalesce(..., 0)`, a top-level
  `limit`, a macro the project does not ship, a reference whose name is not written out, and
  a test for a column the SQL never names.
- **What it could not verify**, always: whether the SQL compiles, whether a payload key
  exists, the column types, whether the tests pass, and what a called function does.

Each finding and each unverified item comes back worded in the caller's language. The check
lives in `packages/db/src/services/`, next to `dbtProject.ts`, whose sources it reads from
`SOURCES_YML` itself. `jinja.ts` and `sqlLexer.ts` report facts. `sqlChecks.ts` and
`modelCheck.ts` decide, both in the vocabulary of `modelFindings.ts`.

Three choices in it:

- **It is a read**, so a read grant may use it. It is a POST because a model's SQL does not
  fit a query string, as `bi.answer` is.
- **It advises and never gates `models.save`.** The Models editor promises that a saved
  mistake is a row, not a broken table, and a person may save a draft on purpose. The skill
  is what makes the check mandatory for an agent.
- **It is not the security boundary.** The tenant's dbt login's grants are. The check is
  there so an author hears about a mistake while it is still text.

The report-parameter error was found while writing the skill. A question writes its
parameters `{{ name }}`, which is also how Jinja writes a variable. dbt renders an unknown
name as an empty string, so a question saved as a model would build successfully with its
filter silently gone. That is the wrong value that looks right which the platform's second
rule forbids.

### Skills are written in English

A skill is instructions for an agent, and the published skill always was in English. The
i18n rule governs text the platform words for a person: tool descriptions, refusals, and the
messages `models.check` returns. The skill tells the agent to give those messages to the
person as they arrive, so the person still reads them in their own language.

## Options rejected

- **An MCP server as its own package, run over stdio.** The handoff's `npx @org/product-mcp`
  would be a second process and a second place the surface is rebuilt, and stdio needs a
  shell, which claude.ai's connectors do not have. ADR 0060 rejected it for these reasons, and
  they have not moved.
- **Serving the skills as MCP prompts.** Prompts are for a person to pick from a menu; they
  have no manifest and no integrity, and hosts would treat them as templates rather than as
  skills. The official extension exists for exactly this, so it is what is used.
- **`undercroft skills list` / `get` in the CLI.** The skill already pins its CLI release, so
  the text the CLI could bundle is the text the installed skill has. Bundling would be a second
  copy with no new information.
- **Guardrails in the skill alone.** An agent that skips a paragraph is not stopped by it. A
  procedure that answers with findings is something the skill can require, and a person using
  the web UI can be offered the same answer later.
- **Refusing `models.save` on an error.** It would break the editor's save-a-draft promise
  for every person, in order to guard against an agent that the skill already guards.
- **`directoryRead` in the extension.** The manifest already lists every file, and serving a
  directory listing too would be a second answer to the same question.
- **Keeping the name `undercroft-cli`.** The skill now teaches both doors, and a name that
  says CLI would send an MCP-only host's person to the wrong door.

## Consequences

- An agent installs one family (`npx skills add muitneliss/undercroft`), or its host reads the
  same family from `/mcp`, and follows the same workflows through either door.
- A router change that renames or removes a procedure a skill names fails the gate until the
  skill follows. A new workflow skill fails it until the entry skill names it.
- A person who installed `undercroft-cli` removes it and adds `undercroft`, once.
- `models.check` is a procedure like any other, so it is a CLI command and an MCP tool with
  nothing written per door. The web UI's Models editor does not show its findings yet; that is
  a UI change of its own.
