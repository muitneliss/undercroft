# Agent skills

Undercroft publishes a family of Agent Skills for an agent that works in it on a person's
behalf: Claude Code, Codex, or any host that reads skills. The skills teach the workflows. The
agent carries them out through one of the two doors, the MCP tools at `/mcp` or the
`undercroft` CLI. ADR 0067 records the decisions; this is how to use them and how to add one.

## The skills

| Skill                      | What it is for                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `undercroft`               | The entry. It says which door to use, how an operation is spelled on each, what a refusal means, what only the person can do, and how to report a defect. Read before any other. |
| `undercroft-model-builder` | Saving a query as a dbt model, or building a new one. Interviews the person first, reads the lake, runs `models.check`, and asks before it saves and again before it builds.     |

They live in `skills/` at the repository root, and that is the only copy.

## Installing them

Install every skill:

```sh
npx skills add muitneliss/undercroft
```

Or one at a time, for one agent, without prompts:

```sh
npx skills add muitneliss/undercroft --skill undercroft --agent claude-code -y
npx skills add muitneliss/undercroft --skill undercroft-model-builder --agent codex -y
```

Add `-g` to install for every project rather than the current one.

The skills need a door. Give the agent one of these:

- **MCP:** connect the host to `https://<your control plane>/mcp`, as
  [connecting over MCP](mcp-setup.md) describes. The skills then use the `undercroft` tools.
- **The CLI:** nothing to do. With no MCP tools present, the `undercroft` skill installs its
  pinned CLI release on first use. [The CLI](cli.md#as-an-agent) covers it.

### Moving from `undercroft-cli`

Releases before 1.41 published one skill, `undercroft-cli`. It is now `undercroft`, and it
covers both doors. Remove the old one and add the new:

```sh
npx skills remove undercroft-cli
npx skills add muitneliss/undercroft
```

The CLI's commands, its error codes and the MCP tools are unchanged; only the skill's name and
text moved.

## Skills over MCP

`/mcp` also serves these same skills through the MCP Skills extension
(`io.modelcontextprotocol/skills`). A host that supports it discovers them with `skills/list`
and reads each file at `skill://<name>/<path>`, with nothing to install. The extension is
declared only when the control plane has skills to serve.

Support among hosts is still arriving. As of September 2026 no Claude host reads skills over
MCP, and ChatGPT reads a static snapshot. Install with `npx skills` for Claude Code and Codex.
The extension reaches hosts as they adopt it.

To check a server against the extension, with a token minted on the account page:

```sh
npx @modelcontextprotocol/inspector --cli https://<your control plane>/mcp \
  --transport http --header "Authorization: Bearer upat_…" --method skills/list --verify
```

Exit `0` means every skill conforms and every file matches its manifest's digest and size.
`7` means a violation, and the NDJSON on stdout names it.

## Adding a workflow skill

A workflow is named for what a person wants, not for a tool: `undercroft-model-builder`, not
`models-save`.

1. Create `skills/<name>/SKILL.md` with `name: <name>` and a `description` of at most 1024
   characters that says when to use it. The name is lowercase words joined by single hyphens,
   and it must match the directory.
2. Name every operation by its procedure path in backticks, such as `models.check`, and let
   the `undercroft` skill's naming rule carry it to either door. Put detail an agent needs only
   sometimes in `references/`.
3. Add the new skill to the `## Workflows` list in `skills/undercroft/SKILL.md`.
4. Run `task ci:verify`. It fails on any of these:
   - a procedure, a CLI command or an MCP tool the router does not have;
   - a link to a file the skill does not hold;
   - a workflow the entry skill does not name;
   - an `sql` example `models.check` finds anything in.
5. Run `task ci:skill-check` (it needs the network) to see `npx skills` list it.

A change to the router that renames a procedure a skill uses fails `task ci:verify` until the
skill follows. That is the point: a skill that names a missing operation sends every agent
that installed it to something that is not there.

## When it goes wrong

| What you see                                                        | Why, and what to do                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npx skills add` lists nothing                                      | A `SKILL.md` frontmatter is not valid YAML, or its `name` differs from its directory. `task ci:verify` names which.             |
| the agent says it has no door                                       | Neither `undercroft` MCP tools nor a shell were available. Connect MCP, or run the agent where it can run commands.             |
| `skills/list` is refused as an unknown method                       | The control plane serves no skills: the log line `mcp_skills_unloaded` at boot says why. Tools are unaffected.                  |
| the model builder stops at `WRITES_DISABLED` or `PERMISSION_DENIED` | By design. Saving and building a model need the `admin` role and a write grant (MCP) or a profile that allows writes (the CLI). |
