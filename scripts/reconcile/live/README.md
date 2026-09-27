# Real-data checks

This folder holds the only checks that read real data: a Drive connection's picked tree, file
by file, against the lake Undercroft holds for it. Everything one level up is the logic and its
offline tests, which run in `task ci:verify` with no network and no credential.

```sh
cp scripts/reconcile/live/drive.config.example.json fixtures/live/drive.config.json  # then fill it in
task ci:reconcile-drive-live
```

- **One test per record.** Every Drive file under the connection's picks, of a type it takes,
  is its own test named by its Drive file id: the lake must hold it once, with Drive's
  `mimeType`, `size`, `md5Checksum`, `modifiedTime` and `parents`, and its document of the type
  it lands as with exactly its bytes (a Google Doc, Sheet or Slides file as its export; a file
  over 25 MiB as a refusal naming the ceiling). Every lake record the tree no longer holds is a
  test (its document must be marked deleted, or the reason it cannot be judged is named), and so
  is every sampled download (md5 = Drive's, sha256 = the lake's).
- **Pending and undecided are never green.** A file newer than the last completed run, or one
  the systems expose no evidence to decide, is `todo`. A defect found while a read was not whole
  or the selection moved under the run is `todo` too, with the reason.
- **Read-only.** Undercroft through its CLI's read commands only (an allow-list refuses anything
  else before spawning), under a profile with `allowWrites: false`; Drive with a
  `drive.readonly` token. Never a database.
- **Nothing real in git.** The config (tenant, lake sources, token paths) lives in
  `fixtures/live/` (git-ignored) or at `UNDERCROFT_LIVE_CONFIG`. `outDir` must be outside the
  repository: `summary.json` and `judged.jsonl` there name real file ids.
- The `.live.ts` suffix is outside `bun test`'s default pattern, so the gate never collects it.
