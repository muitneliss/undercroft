# vietcham-data-ops — working conventions

> `AGENTS.md` is a **symlink to this file**, so Codex and Claude read the same
> rules and cannot drift apart. Edit `CLAUDE.md`; never replace the symlink
> with a copy. The legacy repo kept two byte-identical files and needed a
> sync step to stop them diverging -- a symlink removes the failure mode
> rather than policing it.

Read this before changing anything. It is short on purpose, and it is now a
**map**: the enforceable detail lives in `.claude/rules/`, one file per concern,
and the reasoning lives in `docs/adr/` and in module docstrings next to the code
they constrain. Each rule has exactly one owner — the same instinct as the
symlink above, applied one level down.

## What this is

A data platform: HubSpot, Xero, Gmail and Google Drive → an immutable raw lake on
S3/MinIO → curated tables in Postgres → Metabase.

The source reference is the legacy repo at
`/Users/cuong/Desktop/repo/vcc-ostwin-architecture-review`. It solves the same
domain problem on one operator's machine with local SQLite and CSV. **Read it
before designing anything new** — most questions here have already been answered
there, often expensively. It is a reference, not a dependency: nothing in this
repo imports from it.

## The three rules that matter most

1. **Raw is the only durable layer.** Everything in Postgres is a projection and
   may be dropped and rebuilt. Raw cannot be recomputed.

2. **Never guess; return nothing and say why.** An empty cell is visibly
   missing; a wrong value is invisibly false. "No evidence" is never "pass".

3. **PII does not enter git.** Client names are PII. Tracked files use CASE-IDs.

The specifics of all three are enforced by the rule files below.

## Rules

`.claude/rules/*.md` are path-scoped: each loads when a matching file is opened,
which is the moment its rule actually bites. **Claude Code discovers these
automatically. Other agents do not — if you are not Claude Code, read the ones
matching the files you are about to touch.** That is the only reason this index
exists.

| Rule file | Applies to | Governs |
|---|---|---|
| `data-integrity.md` | `vcdo/**/*.py`, `migrations/**/*.sql` | `Decimal` end to end, explicit dated currency conversion, three-valued comparison, `None`/`""` over a guess |
| `raw-lake.md` | `vcdo/lake/**`, `vcdo/sources/**` | create-only writes, idempotent by content, retention bounded and reported |
| `tests.md` | `tests/**/*.py` | `tmp_path` only, real in-memory over mocks, a guard needs two tests, pin what you import |
| `pii.md` | `tests/**`, `fixtures/**`, `docs/**`, `wiki/**`, `*.md` | CASE-IDs in tracked files; what must never be committed |
| `deployment.md` | `deploy/**`, `flows/**` | Dokploy API is the only channel, SSH read-only, explicit memory limits |

## Ingestion

There is **no ingestion platform** in this stack. No Airbyte, no Meltano, no
Kubernetes. One `worker` container does everything, and `dlt` is a library
inside it, not a service. The whole platform is one `docker compose up`.

Record-oriented sources go through dlt (verified source for HubSpot, its
declarative REST toolkit for Xero and Gmail metadata). Byte-oriented paths ---
Drive PDFs and Gmail attachments --- go through `vcdo.lake.LakeStore`, because
no record-oriented ELT tool writes binary files and that is half the scope.
Scheduling is Kestra. See ADR 0003.

## The gate

`make verify` — ruff check, ruff format --check, and the gate tests. Run it
before claiming anything works. CI runs the same command on push to `main` and
on every pull request, calling `make` rather than spelling the tools out, so
there is exactly one definition of the gate.

**A green `make verify` is not evidence that the rules above held.** ruff cannot
see "never guess", create-only lake writes, or the Dokploy channel rule; the rule
files are their only enforcement. Treating green as proof would be rule 2 broken
by the harness itself.

CI does add two mechanical slices on top — every compose service declares a
memory limit, and secret-bearing paths stay untracked. Those are the *floor* of
`deployment.md` and `pii.md`, not the whole of either: they catch the two ways
each rule gets broken by accident, and nothing about the ways it gets broken by
reasoning.

`pyright` is pinned and configured but deliberately **outside** the gate. CI runs
it non-blocking so the true error count is visible on every push; it becomes a
gate once that number is known and small, and not before.

## Commits and releases

Commit messages use **Conventional Commits** (`feat:`, `fix:`, `docs:`,
`chore:`, `refactor:`, `test:`). release-please derives the version bump and
`CHANGELOG.md` from them, so a non-conventional message silently produces no
release. History before this convention was adopted is not conventional; that is
fine and is not rewritten.

Merging the release PR bumps `[project].version`, writes the changelog and cuts a
tag. **It does not deploy.** Shipping stays a human action through the `dokploy`
skill.

## Where knowledge lives

- `docs/` — **decisions we made.** Numbered, dated, immutable. A reversal gets a
  new ADR superseding the old one; we never edit a decision to look like it was
  always different, because then the reasoning that produced it is lost.
- `wiki/` — **facts we learned.** Measured, updatable, keyword-searchable;
  chiefly the expensive findings distilled from the legacy system. An ADR may
  cite a wiki page for the measurement behind it; a wiki page never records a
  decision.

> **`wiki/` does not exist yet.** `wiki init` is broken in Ymir CLI 0.8.0
> (`ENOENT: lstat 'bun'`). Until it is scaffolded, learned facts go in `docs/`
> and the CI wiki guard stays commented out in `.github/workflows/ci.yml`.
> `.claude/rules/pii.md` already covers `wiki/**` so the PII rule binds it from
> the first page.

## Conventions

- Python 3.12, package `vcdo/`. (Not `platform/` — that shadows the stdlib.)
- `docs/adr/NNNN-topic.md` for decisions. Status, date, the options rejected and
  why.
- Module docstrings explain *why*, especially where the code refuses to do the
  obvious thing. A constraint without a recorded reason gets "simplified" away by
  the next reader.
- Lint rules that fight the codebase get disabled **with a written reason**, not
  worked around file by file.
