# Test case matrix: live reconciliation

Every case the suite can report, the requirement it answers, and the contract it is judged
against. Offline cases run in `bun test scripts/reconcile`; live cases run in
`bun run scripts/reconcile/cli.ts` (see [the runbook](runbook.md)). `{C}` is a client label
(CASE-ID), `{M}` a mailbox (`primary`, `secondary`), `{S}` a lake source, `{R}` a Drive root role.

## Requirements

| Id         | Requirement                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| REQ-GEN-01 | every source is read live, read-only, by the identity both warehouses claim    |
| REQ-GEN-02 | every listing is read to its end: no page cap, repeated cursor or short read   |
| REQ-GEN-03 | an ingest run completes, or fails for a reason of its own                      |
| REQ-GM-01  | a mailbox token reads the mailbox both warehouses read                         |
| REQ-GM-02  | OSTWIN holds every message its declared routes find                            |
| REQ-GM-03  | Undercroft holds every message under a label its connection reads              |
| REQ-GM-04  | a message is identified by mailbox and Gmail id, never the bare id             |
| REQ-GM-05  | the two warehouses agree over the messages both promise                        |
| REQ-HS-01  | the lake holds the commercial picture, quotes included                         |
| REQ-HS-02  | every live company, contact and deal is mirrored once with its contract fields |
| REQ-HS-03  | every deal keeps its company links                                             |
| REQ-HS-04  | a client resolves to live company records                                      |
| REQ-HS-05  | a client's deals are reachable from its company in each warehouse              |
| REQ-DQ-01  | one commercial event is one deal                                               |
| REQ-DR-01  | one client, one folder per root                                                |
| REQ-DR-02  | Undercroft holds every file of the client folders it reads                     |
| REQ-DR-03  | Undercroft stores the bytes of every file whose type it reads                  |
| REQ-DR-04  | the lake's documents and file records describe the same files                  |
| REQ-DR-05  | every stored document is read or refused with a reason                         |
| REQ-DR-06  | OSTWIN's inventory lists every file of the client folders it scans             |
| REQ-DR-07  | the two warehouses agree on the files they both read                           |

## Live cases

| Id                                      | Group       | Leg | Requirement | Contract judged against                                             | Expected                                                 |
| --------------------------------------- | ----------- | --- | ----------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `GM-ID-001-{M}`                         | live        |     | REQ-GM-01   | connection `externalAccountLabel`; Gmail profile                    | three addresses equal, else BLOCKED                      |
| `GM-U-PAGE-001-{M}`                     | integration |     | REQ-GEN-02  | `lake records` cursor paging; `lake summary` count                  | exhausted, no repeats, count = summary                   |
| `GM-S2U-MBX-001-{M}`                    | live        | S2U | REQ-GM-03   | one listing per connection label, unioned                           | every listed message in the lake once                    |
| `GM-U-XMBX-001`                         | regression  |     | REQ-GM-04   | mailbox-qualified keys (issue #143)                                 | no id names two letters                                  |
| `GM-{C}-O-PAGE-001`                     | regression  |     | REQ-GEN-02  | OSTWIN coverage: exhausted, below the 20-page cap                   | every route exhausted below its cap                      |
| `GM-{C}-S2O-{M}`                        | live        | S2O | REQ-GM-02   | OSTWIN routes, discard list, published harvest, unpublished harvest | no MISSING scope hit; fields equal                       |
| `GM-{C}-S2U-{M}`                        | live        | S2U | REQ-GM-03   | connection labels; lake headers                                     | in-label client messages present, headers equal          |
| `GM-{C}-O2U-{M}`                        | live        | O2U | REQ-GM-05   | OSTWIN labels x connection labels x lake watermark                  | common-scope messages present, fields equal              |
| `GM-{C}-S2O-001`                        | live        | S2O | REQ-GM-02   | one Gmail source candidate per CASE-ID                              | BLOCKED when the client has no CASE-ID                   |
| `HS-PRE-001`                            | integration |     | REQ-GEN-01  | HubSpot token present                                               | BLOCKED without a token                                  |
| `HS-REQ-OBJ-001`                        | contract    |     | REQ-HS-01   | `specs/connectors/hubspot.yaml` entities                            | the 7 object types the business uses                     |
| `HS-{COMPANIES,CONTACTS,DEALS}-S2O-001` | live        | S2O | REQ-HS-02   | OSTWIN full-portal mirror                                           | every live record once, fields equal                     |
| `HS-{COMPANIES,CONTACTS,DEALS}-S2U-001` | live        | S2U | REQ-HS-02   | connector property floor + selection                                | every live record once, read fields equal                |
| `HS-{COMPANIES,CONTACTS,DEALS}-O2U-001` | live        | O2U | REQ-HS-02   | both mirrors, records created before OSTWIN's snapshot              | agree                                                    |
| `HS-ASSOC-DC-{S2O,S2U,O2U}-001`         | live        | all | REQ-HS-03   | deal->company pairs                                                 | every pair on each side                                  |
| `HS-QUOTES-S2O-001`                     | live        | S2O | REQ-HS-01   | OSTWIN quotes mirror                                                | every live quote, fields equal                           |
| `HS-QUOTES-{S2U,O2U}-001`               | live        |     | REQ-HS-01   | the lake has no quotes entity                                       | OUT_OF_SCOPE                                             |
| `HS-{C}-LINK-001`                       | integration |     | REQ-HS-04   | OSTWIN client link; companies batch read                            | pinned company = OSTWIN link, live                       |
| `HS-{C}-DEALS-{S2O,S2U,O2U}-001`        | live        | all | REQ-HS-05   | v4 company->deals; OSTWIN companies->deals; lake deal->companies    | same deal set                                            |
| `HS-{C}-DUP-001`                        | live        |     | REQ-DQ-01   | same name + amount + close date on one company                      | no duplicate group                                       |
| `DR-U-PAGE-001-{S}`                     | integration |     | REQ-GEN-02  | `lake records` / `lake documents` paging                            | exhausted, no repeats, counts = summary                  |
| `DR-U-DOCFILE-001-{S}`                  | integration |     | REQ-DR-04   | documentId = Drive file id                                          | no live document without a file record                   |
| `DR-U-EXTRACT-001-{S}`                  | integration |     | REQ-DR-05   | summary readable / refused / waiting                                | waiting = 0, else PENDING                                |
| `DR-U-REG-218`                          | regression  |     | REQ-DR-05   | no NUL byte in the extract batch insert                             | no run failed on 0x00                                    |
| `DR-U-REG-219`                          | regression  |     | REQ-GEN-03  | the worker survives a large Drive run                               | no run ended by a stopped worker                         |
| `DR-{C}-FOLDER-001-{R}`                 | integration |     | REQ-DR-01   | `<root>/Active/<CLIENT>`                                            | one folder; none is OUT_OF_SCOPE                         |
| `DR-{C}-S2U-{R}`                        | live        | S2U | REQ-DR-02   | lake `files` record fields                                          | every file once, fields equal, after a completed run     |
| `DR-{C}-DOC-{R}`                        | live        | S2U | REQ-DR-03   | connection `fileTypes`; lake documents                              | every in-type file stored, byte size equal               |
| `DR-{C}-S2O-{R}`                        | live        | S2O | REQ-DR-06   | OSTWIN `document_index` file inventory                              | every file older than the scan inventoried               |
| `DR-{C}-O2U-{R}`, `DR-{C}-O2U-incorp`   | live        | O2U | REQ-DR-07   | same tree by id; across trees by relative path                      | every OSTWIN file with a live counterpart is in the lake |
| `{GM,HS,DR}-{C}-RUN`                    | live        |     | REQ-GEN-01  | the client's data readable                                          | BLOCKED with the error when a read fails                 |

## Offline cases

| Id               | File                   | Pins                                                                                                                  |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| UT-KEY-001..008  | `core.test.ts`         | identity: mailbox-qualified Gmail ids, letter keys, HubSpot ids, NFC paths, extensions that are not                   |
| UT-PAGE-001..005 | `core.test.ts`         | paging: exhausted vs capped, cursor loops, repeats, short reads                                                       |
| UT-CLS-001..012  | `core.test.ts`         | every verdict, and the order absence is judged in                                                                     |
| UT-STAT-001..005 | `core.test.ts`         | the fold to an exit code; an empty comparison is never a pass                                                         |
| CT-OST-001..008  | `adapters.test.ts`     | ask.py: chunked transport beats the 60-character clip, row-limit and footer guards, named-query cap, trust header     |
| CT-UC-001..005   | `adapters.test.ts`     | the CLI: write procedures refused before spawning, paging, short reads, error envelopes, the walk cache               |
| CT-GG-001..005   | `adapters.test.ts`     | Google: page tokens, 404 as absent, header case, rate-limit retry, query never in an error, Drive trees across drives |
| CT-HS-001..002   | `adapters.test.ts`     | HubSpot: `after` cursors, association de-duplication, batch-read ids not returned                                     |
| CT-CFG-001..003  | `config.test.ts`       | the example has placeholders only; evidence inside the repo is refused; duplicate labels refused                      |
| IT-GM-001..009   | `gmailSuite.test.ts`   | the Gmail suite end to end over an invented world                                                                     |
| IT-HS-001..007   | `hubspotSuite.test.ts` | the HubSpot suite end to end over an invented portal                                                                  |
| IT-DR-001..006   | `driveSuite.test.ts`   | the Drive suite end to end over invented trees                                                                        |
| RG-*             | `regression.test.ts`   | one case per historical finding, both sides                                                                           |

## Findings and the tests that reproduce them

| Finding                                                                           | Reproduced by                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A Gmail id taken without its mailbox (issue #143)                                 | UT-KEY-001, RG-143, `GM-U-XMBX-001`                       |
| NUL byte stalls extraction (issue #218)                                           | RG-218, IT-DR-005, `DR-U-REG-218`, `DR-U-EXTRACT-001-{S}` |
| Worker stopped mid-run (issue #219)                                               | RG-219, `DR-U-REG-219`                                    |
| OSTWIN's 20-page cap could truncate a harvest                                     | RG-OST-PAGES, RG-OST-ROUTE, `GM-{C}-O-PAGE-001`           |
| ask.py clips cells at 60 characters                                               | CT-OST-001, CT-OST-002                                    |
| ask.py named queries cap at 200 rows                                              | CT-OST-006, CT-OST-007                                    |
| Gmail header case read as a missing Message-ID (found by this suite)              | CT-GG-002b                                                |
| An unpublished OSTWIN harvest read as missing mail (found by this suite)          | UT-CLS-012, IT-GM-009                                     |
| Records created after OSTWIN's snapshot read as lake extras (found by this suite) | RG-HS-LAG                                                 |
| The lake collects 3 of 7 HubSpot object types, no quotes                          | RG-HS-OBJ, IT-HS-005, `HS-REQ-OBJ-001`                    |
| A duplicated deal on one client                                                   | RG-HS-DUP, IT-HS-006, `HS-{C}-DUP-001`                    |
| A dot in a file name read as an extension                                         | UT-KEY-008                                                |
| Duplicated client folders                                                         | IT-DR-004, `DR-{C}-FOLDER-001-{R}`                        |
| Drive judged before ingestion completed                                           | IT-DR-002                                                 |
