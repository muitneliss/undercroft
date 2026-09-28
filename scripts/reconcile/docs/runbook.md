# Runbook: Live Gmail reconciliation

How to run the reconciliation described in [the design](design.md), and how to read what it
produces.

## Where the real-data checks live

`scripts/reconcile/live/` holds the only checks that read real data. Everything one level up is the
framework and its offline tests, which run in `task ci:test` and CI with no network and no credential.

```sh
task ci:reconcile-gmail-live
```

- Collected only when named by path: the `.live.ts` suffix is outside `bun test`'s default
  pattern, so neither `task ci:test` nor CI runs these. The task sets `UNDERCROFT_LIVE=1`; the
  file named without it registers one `todo` and reads nothing.
- Read-only: Gmail through its API with a `gmail.readonly` token, the lake through the
  Undercroft CLI (`undercroft --agent`, read commands only); never a database.
- The configuration (mailbox addresses, token paths) stays local in
  `fixtures/live/gmail.config.json` (git-ignored) or the file `UNDERCROFT_LIVE_CONFIG`
  names; evidence goes to its `outDir`, outside the repository.

## Offline (every change, no credentials)

```sh
task ci:test
```

Runs the unit, contract, integration and regression cases in `scripts/reconcile/` against
in-memory stand-ins, with the rest of the offline suite. No network, no credential, no file
written. `task ci:verify` covers it.

## Live (a person, with the credentials)

### Prerequisites

- Bun as pinned in `.bun-version`, and `bun install` done.
- The `undercroft` CLI on `PATH`, signed in (`undercroft auth login`) as a member with admin on
  the tenant: `lake records` and `connections list` are admin reads.
- A Google authorized-user token file (`gmail.readonly`) for each of the two mailboxes.

### Configuration

Copy `scripts/reconcile/live/gmail.config.example.json` to `fixtures/live/gmail.config.json`
(git-ignored) and fill it in, or keep it anywhere outside the repository and name it in
`UNDERCROFT_LIVE_CONFIG`. `outDir` must be outside this repository; the run refuses otherwise.

| Field                           | Meaning                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `tenantId`                      | the Undercroft tenant                                                                  |
| `outDir`                        | where runs, evidence and the read caches are written (outside this repo)               |
| `mailboxes.{primary,secondary}` | `address` the token must read, `tokenFile`, and the lake `undercroftSource` holding it |

### Run

```sh
task ci:reconcile-gmail-live
UNDERCROFT_LIVE_CONFIG=/elsewhere/reconcile.config.json task ci:reconcile-gmail-live
```

Every message under a label the connection reads, and every attachment its file types allow,
becomes its own test, named by its key: `pass` present with equal fields, `fail` missing /
extra / duplicated / different, `todo` newer than the lake's last completed run (PENDING, never
a pass) or undecidable on the evidence (BLOCKED), `skip` outside the confirmed scope with the
rule named. Progress lines (`[hh:mm:ss] <case>: N record(s) judged`) go to stderr while the run
reads. The file named without `UNDERCROFT_LIVE=1` -- which the task sets -- registers one `todo`
and reads nothing.

Gmail's quota, not the lake, sets the pace: message reads are spaced 330 ms apart per mailbox.
Every read lands in `<outDir>/gmail-cache.jsonl`, and lake walks are reused from
`<outDir>/lake-cache/` for up to 12 hours, unless a run of that source ended or is running after
the walk was taken. Delete either to read afresh.

### Verdict

`summary.md` records the run's verdict as an exit code:

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| 0    | every case `PASS` or `OUT_OF_SCOPE`             |
| 1    | at least one `FAIL`                             |
| 2    | no `FAIL`, but some case `PENDING` or `BLOCKED` |

### Output

```
<outDir>/<run-id>/
  summary.md        ids, statuses, counts, reasons, watermarks -- the shareable part
  results.json      every case in full, with the run's meta and summary
  evidence/
    watermarks.json               the lake summary at run start
    <case-id>.jsonl               the case's non-matching records: key, verdict, reason, diffs
    <case-id>-facts.json          sizes, watermarks and fields compared
<outDir>/gmail-cache.jsonl        Gmail reads of this session
<outDir>/lake-cache/              saved lake walks
```

`evidence/` and the caches name real messages. They stay on the machine that ran them.

### Reading a result

- `NOT_YET_SYNCED` with "newer than the target's last completed run" -- run again after the next
  ingest; if it is still there, it becomes a verdict.
- `OUT_OF_SCOPE` with "retained by policy" -- the lake keeps a message it read after the message
  left the label selection, was trashed or deleted; the connector never tombstones.
- `BLOCKED` -- read the reason. An absent message older than the last run is `BLOCKED` because
  Undercroft does not record the label selection or file types each run read; a mailbox whose
  token reads the wrong account blocks every case for that mailbox by design.
- A `FAIL` names the verdicts behind it; `<case-id>.jsonl` holds each record with both sides'
  values. Verify one record by hand before reporting a defect upstream.
