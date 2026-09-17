# vietcham-data-ops — working conventions

Read this before changing anything. It is short on purpose; the reasoning lives
in `docs/adr/` and in module docstrings next to the code it constrains.

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
   may be dropped and rebuilt. Raw cannot be recomputed — if a source edits or
   deletes their side, what we did not capture is gone. Treat writes to the lake
   accordingly.

2. **Never guess; return nothing and say why.** An unreadable amount is `None`,
   not `0`. An unresolved identity is `""`, not a best guess — a wrong code is
   worse than an empty cell, because an empty cell is visibly missing and a wrong
   code is invisibly false. "No evidence" is never "pass".

3. **PII does not enter git.** Client names are PII. Tracked files — docs, tests,
   fixtures, reports — use CASE-IDs. Real names live only in restricted storage
   and in conversation with the owner. Never commit `.dokploy.json`, tokens, or
   anything under `data/`.

## Ingestion

There is **no ingestion platform** in this stack. No Airbyte, no Meltano, no
Kubernetes. One `worker` container does everything, and `dlt` is a library
inside it, not a service. The whole platform is one `docker compose up`.

Record-oriented sources go through dlt (verified source for HubSpot, its
declarative REST toolkit for Xero and Gmail metadata). Byte-oriented paths ---
Drive PDFs and Gmail attachments --- go through `vcdo.lake.LakeStore`, because
no record-oriented ELT tool writes binary files and that is half the scope.
Scheduling is Kestra. See ADR 0003.

## Money

`Decimal` end to end, `NUMERIC(18,4)` in Postgres, never `float`. Amounts carry
their currency and are never implicitly converted; conversion is an explicit step
through a dated rate. Comparison is three-valued (`ok` / `mismatch` /
`unverified`) — see `vcdo/core/money.py`.

## Tests

- `make verify` is the gate: ruff + the `tests/` path.
- `tests/monitors/` binds to live data or deployed services. Red there means data
  drift, not a code defect, so it is excluded from the gate and run explicitly.
  This is `norecursedirs`, not `addopts --ignore`, because the latter would make
  `pytest tests/monitors/` silently collect nothing.
- **Tests never write into the repo.** Use `tmp_path`; anything under test takes
  an explicit output destination.
- If a test imports a module, it is pinned in `requirements-dev.txt`. Installing
  by hand gives you green and the next machine red.
- Prefer a real in-memory implementation over a mock. A suite that asserts a mock
  was called is green whether or not the code works.
- A guard needs two tests: one proving it fires, one proving it stays quiet.
- Coverage is not correctness. Before trusting any extraction output, measure how
  much of it is *right* — and report an interval, not a bare percentage.

## Deployment

Through the `dokploy` skill, against `https://lowbit.link/api`. **The API is the
only channel for changes; SSH is read-only, for diagnosis.** Direct edits on the
server bypass Dokploy's state and cause drift.

Never fabricate a Dokploy endpoint name — fetch `settings.getOpenApiDocument` and
search it. Services deploy as raw compose; `deploy/compose/` in this repo is the
source of truth and Dokploy holds a copy.

We are a tenant on a shared host running eleven other projects. Every service
carries an explicit memory limit. See ADR 0001 for measured capacity.

## Conventions

- Python 3.12, package `vcdo/`. (Not `platform/` — that shadows the stdlib.)
- `docs/adr/NNNN-topic.md` for decisions. Status, date, the options rejected and
  why. If a decision is reversed, write a new ADR superseding the old one rather
  than editing history.
- Module docstrings explain *why*, especially where the code refuses to do the
  obvious thing. A constraint without a recorded reason gets "simplified" away by
  the next reader.
- Lint rules that fight the codebase get disabled **with a written reason**, not
  worked around file by file.
