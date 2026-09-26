# Runbook: Live reconciliation

How to run the reconciliation described in
[the design](design.md), and how to read what it produces.

## Offline (every change, no credentials)

```sh
bun test scripts/reconcile
```

Runs the unit, contract, integration and regression cases against in-memory stand-ins. No
network, no credential, no file outside a temp directory. It is part of `bun run test`, so
`bun run verify` covers it.

## Live (a person, with the credentials)

### Prerequisites

- Bun as pinned in `.bun-version`, and `bun install` done.
- The `undercroft` CLI on `PATH`, signed in (`undercroft auth login`) as a member with admin on
  the tenant: `lake records` and `connections list` are admin reads.
- For the OSTWIN side: a checkout of the old warehouse's repository with `python3 scripts/ask.py` working.
- Google authorized-user token files (`gmail.readonly`, `drive.readonly`) for each mailbox, and
  a HubSpot private-app token with read scopes in an env file (`HUBSPOT_ACCESS_TOKEN=...`).

### Configuration

Copy `scripts/reconcile/reconcile.config.example.json` to `fixtures/live/reconcile.config.json`
(git-ignored) and fill it in. Label each client by its CASE-ID, never by name: the label reaches
the summary report. `outDir` must be outside this repository; the run refuses otherwise.

| Field                           | Meaning                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `tenantId`                      | the Undercroft tenant                                                                                               |
| `ostwinRoot`                    | the old warehouse's repository root, where `scripts/ask.py` runs                                                    |
| `outDir`                        | where runs and evidence are written (outside this repo)                                                             |
| `hubspotEnvFile`                | env file holding `HUBSPOT_ACCESS_TOKEN`                                                                             |
| `mailboxes.{primary,secondary}` | `address` the token must read, `tokenFile`, and the lake `undercroftSource` holding it                              |
| `driveRoots[]`                  | `role`, which mailbox token reads it (`readAs`), the lake `undercroftSource` or `null`, and whether OSTWIN scans it |
| `clients[]`                     | `label`, `caseId` (or `null`), OSTWIN `clientId`, `hubspotCompanyIds`, and `driveFolders[]` (`role`, `folderId`)    |

### Run

```sh
bun run scripts/reconcile/cli.ts --config fixtures/live/reconcile.config.json
bun run scripts/reconcile/cli.ts --config fixtures/live/reconcile.config.json --source gmail --client CASE-00
bun run scripts/reconcile/cli.ts --config fixtures/live/reconcile.config.json --lake-cache-minutes 240
```

| Flag                     | Default                 | Meaning                                                                                                                            |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--config <file>`        | required                | the local configuration                                                                                                            |
| `--source a,b`           | `gmail,hubspot,drive`   | which suites to run                                                                                                                |
| `--client L1,L2`         | every configured client | restrict to these labels                                                                                                           |
| `--lake-cache-minutes N` | `0`                     | reuse lake walks saved within N minutes under `<outDir>/lake-cache/`; each reused walk's time is written into the run's watermarks |

A full run reads ~37,000 lake Gmail rows, ~17,500 HubSpot rows and ~11,000 Drive file rows
through 50-row CLI pages; expect tens of minutes. The cache is for repeated runs in one session.

### As a test run, one test per record

```sh
UNDERCROFT_LIVE=1 bun test ./scripts/reconcile/live/records.live.ts
UNDERCROFT_LIVE=1 UNDERCROFT_LIVE_SOURCES=drive bun test ./scripts/reconcile/live/records.live.ts
```

Every message, deal and file of the configured clients becomes its own test, named by its id:
`pass` present with equal fields, `fail` missing / extra / duplicated / different, `todo`
newer than the lake's last completed run (PENDING, never a pass), `skip` outside the confirmed
scope with the rule named. Progress lines (`[hh:mm:ss] <case>: N record(s) judged`) go to
stderr while the run reads. Without `UNDERCROFT_LIVE=1` the file registers one `todo` and reads
nothing.

The real-data checks live in their own folder, `scripts/reconcile/live/`, apart from the offline
tests. Their `.live.ts` suffix is outside `bun test`'s default pattern, so `bun run test` and CI
never collect them; they run only when named by path.

### Exit codes

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| 0    | every case `PASS` or `OUT_OF_SCOPE`                                            |
| 1    | at least one `FAIL`                                                            |
| 2    | no `FAIL`, but some case `PENDING` or `BLOCKED`, or the run could not complete |

### Output

```
<outDir>/<run-id>/
  summary.md        ids, CASE-IDs, statuses, counts, watermarks -- the shareable part
  results.json      every case in full, with the run's meta and summary
  evidence/
    watermarks.json               OSTWIN trust header, lake summary at run start
    <case-id>.jsonl               the case's non-matching records: key, verdict, reason, diffs
    <case-id>-facts.json          sizes, watermarks and fields compared
<outDir>/lake-cache/              saved lake walks (only with --lake-cache-minutes)
```

`evidence/` names real messages, files and deals. It stays on the machine that ran it.

### Reading a result

- `NOT_YET_SYNCED` with "newer than the target's last completed run" -- run again after the next
  ingest; if it is still there, it becomes `MISSING`.
- `NOT_YET_SYNCED` with "held in OSTWIN's newer harvest ... not yet published" -- OSTWIN has the
  record in a harvest awaiting review; publishing it closes the case.
- `OUT_OF_SCOPE` -- the confirmed scope excludes it; the reason says which rule. Scope is a
  decision, and the summary lists it so it can be challenged.
- `BLOCKED` -- read the reason; a mailbox whose token reads the wrong account blocks every case
  for that mailbox by design.
- A `FAIL` names the verdicts behind it; `<case-id>.jsonl` holds each record with both sides'
  values. Verify one record by hand before reporting a defect upstream.
