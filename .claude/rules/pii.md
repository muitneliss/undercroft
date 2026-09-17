---
paths:
  - "tests/**"
  - "fixtures/**"
  - "docs/**"
  - "wiki/**"
  - "*.md"
---

# PII does not enter git

Client names are PII. This rule has legal weight (PDPA), and git makes it
effectively irreversible: a name committed once survives in history even after
the file is "fixed". These paths are where it gets broken, because a fixture or
a worked example feels like scratch work rather than a permanent record.

## NEVER

- **NEVER put a client name in any tracked file** — docs, tests, fixtures,
  reports, commit messages, ADRs, wiki pages.
- **NEVER commit `.dokploy.json`, a token file, or any credential.**
- **NEVER commit anything under `data/` or `fixtures/live/`.**

## Follow

- **Tracked files use CASE-IDs.** A CASE-ID is stable, referenceable and
  meaningless outside the restricted store, which is the entire point.
- **Real names live only in restricted storage and in conversation with the
  owner.**
- **Synthetic fixture data is invented, not anonymised.** Anonymising a real
  record leaves the shape, the amounts and the dates, and those re-identify.
- **If you need a real name to reason about something, ask** — do not commit it
  "temporarily".

`.gitignore` is a backstop here, not the control. Note its comment on `*token*`:
a blanket substring rule once silently swallowed a legitimate docs file and
broke a clean-clone test invisibly. Match token *files*, not every path
containing the word.

That lesson was recorded for `*token*` and **not applied to `*secret*` and
`*credential*`, so it recurred twice in one change**:

- `docs/adr/0005-per-tenant-credentials-sealed-in-postgres.md` — a document
  *about* credential storage, silently unstageable.
- `vcdo/core/secrets.py` — **source code**, whose absence from a clean clone is
  an `ImportError` with nothing pointing at the cause.

All three are now explicit file patterns, with a documented exemption for source
and documentation extensions behind them. A file that implements or describes
credential handling is not a credential. The failure is always silent, which is
what makes it worth a rule rather than care — and worth checking
`git check-ignore` on anything new before assuming it is committed.
