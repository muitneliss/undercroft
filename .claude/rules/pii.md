---
description: No real customer data in any tracked file
globs: ["specs/**", "docs/**", "**/*.md", "**/*.test.ts", "**/fixtures/**"]
---

# PII does not enter git

This is an open-source repository. Nothing about a real customer belongs in it.

## NEVER

- **NEVER put a real client name in any tracked file** — docs, tests, fixtures, commit
  messages, ADRs. Use CASE-ids (`CASE-0042`) for tenants.
- **NEVER commit a credential or a secret.** `.env`, key files, token files stay
  untracked; `git check-ignore` anything new before trusting it. Blanket `*secret*`
  substring ignore rules are banned — they once swallowed a legitimate secrets module.
- **NEVER commit real data.** `data/` and any `fixtures/live/` are gitignored.

- **NEVER put a name a human wrote into `raw.documents` or a lake key.** That table is
  granted to `undercroft_dbt`, so every column in it -- `lake_key` included -- is one
  `dbt run` from a dashboard. A filename, a mail subject, an address or a folder name goes
  in the **lake manifest** (`extra` on `LakeStore.put`), which lives in the access-controlled
  object store that dbt and BI cannot reach at all. `raw.documents.metadata` carries only
  opaque provider ids, timestamps, enumerated types and counts. `landDocuments` takes
  `metadata` and `manifest` as two separate arguments so the split is visible at every call
  site; see `apps/worker/src/services/landDocument.ts` and ADR 0013.

## Follow

- Fixtures are **invented, not anonymised.** Anonymising preserves shapes, amounts and
  dates, which re-identify. Synthetic names (`Acme`, `example.test`) are the rule.
- A name committed once survives in history even after the file is "fixed". Ask before
  committing anything you are unsure about.
