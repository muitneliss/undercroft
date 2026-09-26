# Real-data checks

This folder holds the only checks that read real data. Everything one level up is the framework
and its offline tests, which run in `bun run test` and CI with no network and no credential.

```sh
UNDERCROFT_LIVE=1 bun test ./scripts/reconcile/live/records.live.ts
```

- Collected only when named by path: the `.live.ts` suffix is outside `bun test`'s default
  pattern, so neither `bun run test` nor CI runs these.
- Read-only, through APIs and the Undercroft CLI (`undercroft --agent`, read commands only);
  never a database.
- The configuration (client folder ids, token paths) stays local in `fixtures/live/`
  (git-ignored) or `UNDERCROFT_LIVE_CONFIG`; evidence goes to its `outDir`, outside the repository.

How to prepare a run and read its output: [the runbook](../docs/runbook.md).
