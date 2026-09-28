# Test case matrix: live Gmail reconciliation

Every case the suite can report, the requirement it answers, and the contract it is judged
against. Offline cases run in `task ci:test`; live cases read real data and run from their own
folder, `scripts/reconcile/live/`, through `task ci:reconcile-gmail-live` (see [the runbook](runbook.md)).
`{M}` is a mailbox (`primary`, `secondary`).

## Requirements

| Id         | Requirement                                                                  |
| ---------- | ---------------------------------------------------------------------------- |
| REQ-GEN-01 | every listing is read to its end: no page cap, repeated cursor or short read |
| REQ-GM-01  | a mailbox token reads the mailbox the lake connection reads                  |
| REQ-GM-02  | Undercroft holds every message under a label its connection reads            |
| REQ-GM-03  | a message is identified by mailbox and Gmail id, never the bare id           |
| REQ-GM-04  | Undercroft stores every attachment its connection's file types allow         |

## Live cases

| Id                   | Group       | Leg | Requirement | Contract judged against                                                                                                  | Expected                                                                                                              |
| -------------------- | ----------- | --- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `GM-ID-001-{M}`      | live        |     | REQ-GM-01   | connection `externalAccountLabel`; Gmail profile                                                                         | three addresses equal, else BLOCKED                                                                                   |
| `GM-U-PAGE-001-{M}`  | integration |     | REQ-GEN-01  | `lake records` cursor paging; `lake summary` count                                                                       | exhausted, no repeats, count = summary                                                                                |
| `GM-S2U-MBX-001-{M}` | live        | S2U | REQ-GM-02   | one listing per connection label, unioned; each proven by the label's own count; id, threadId, internalDate, six headers | every listed message in the lake once, fields equal; absent and older than the last run is BLOCKED (no scope history) |
| `GM-S2U-DOC-001-{M}` | live        | S2U | REQ-GM-04   | depth-first part index, attachmentId, `allowsFile(fileTypes)`, `landedType`, 25 MiB ceiling                              | every allowed attachment stored once, same type and size                                                              |
| `GM-U-XMBX-001`      | regression  |     | REQ-GM-03   | mailbox-qualified keys (issue #143)                                                                                      | no id names two letters                                                                                               |

## Offline cases

| Id               | File                 | Pins                                                                                                                                                |
| ---------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| UT-KEY-001..004  | `core.test.ts`       | identity: mailbox-qualified Gmail ids, letter keys                                                                                                  |
| UT-PAGE-001..005 | `core.test.ts`       | paging: exhausted vs capped, cursor loops, repeats, short reads                                                                                     |
| UT-CLS-001..012  | `core.test.ts`       | every verdict, the order absence is judged in, and the leg's own say over undecidable and retained records                                          |
| UT-STAT-001..006 | `core.test.ts`       | the fold to an exit code; an empty comparison is never a pass; a BLOCKED record keeps a leg from passing                                            |
| CT-UC-001..007   | `adapters.test.ts`   | the CLI: write procedures refused before spawning, retries, paging, short reads, error envelopes, the walk cache and when it must not be reused     |
| CT-GG-001..009   | `adapters.test.ts`   | Gmail: page tokens, 404 as absent, header case, full reads and part numbering, label counts, token refresh, query never in an error, rate-limit 403 |
| CT-CFG-001..004  | `config.test.ts`     | the example has placeholders only; evidence inside the repo is refused; one lake source per mailbox; a missing token path is refused                |
| IT-GM-001..009   | `gmailSuite.test.ts` | the Gmail suite end to end over an invented world: identity, messages, retained rows, cached reads, attachments, undecidable absences               |
| RG-*             | `regression.test.ts` | one case per historical finding, both sides                                                                                                         |

## Findings and the tests that reproduce them

| Finding                                                                         | Reproduced by                       |
| ------------------------------------------------------------------------------- | ----------------------------------- |
| A Gmail id taken without its mailbox (issue #143)                               | UT-KEY-001, RG-143, `GM-U-XMBX-001` |
| Attachments of a type matched only after their message was held (issue #292)    | RG-292-1, RG-292-2                  |
| Gmail header case read as a missing Message-ID (found by this suite)            | CT-GG-003                           |
| An expired access token failed every later read (found by this suite)           | CT-GG-006, CT-GG-007                |
| A cached lake walk reused after a run wrote to its source (found by this suite) | CT-UC-006, CT-UC-007                |
| A cached Gmail read the live listing contradicts (found by this suite)          | IT-GM-007                           |
