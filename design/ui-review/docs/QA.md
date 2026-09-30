# Verification record — review r5

Date: 2026-09-29. Scope: the offline review package, not production Undercroft. Reference
repository state: `muitneliss/undercroft` at `116a41e` (release 1.53.0).

## Automated checks actually run

```sh
for f in assets/*.js; do node --check "$f"; done
node --test tests/*.test.cjs
```

**43 tests passed, 0 failed:** 34 in `domain.test.cjs` and 9 in `workspace.test.cjs`. The operator-path tests cover:

- Models list: one count per last-build state, the counts add up to the list (also on a searched subset and after a new model), and "never built" is its own state, not "running" and not "new".
- Route state round-trips through the address, including Vietnamese text.
- Lineage: nodes are only models, the two raw lake tables and missing refs; edges are only model → model (ref) and raw lake table → model (declared source); selecting a model highlights its upstream chain only; no edge is inferred from similar names, filters or a second mailbox; a dynamic reference is marked "upstream not declared"; a ref to a deleted model is a missing dependency with its edge kept; fixture SQL agrees with the declared lineage; traversal terminates on cycles; a model three levels deep has a readable text path.
- Lineage stays inside Models: seven real divisions, no lineage division, no modal or `<dialog>` in any script, stepped motion in every stylesheet.
- Scope: a save states the held-records effect per kind, and no statement implies anything is erased from the lake; empty-selection semantics per kind.
- Journal and runs: narrowing to one of two mailboxes; a run's counts lead to exactly the records it wrote, with later rewrites counted; a run shows the scope it started with and an older run has none; members and viewers see counts as plain figures.
- Sources: write plates absent for member and viewer, state-driven for admin.
- Stream identity, payload lexemes, raw-read guards, model-name validation, fixture references, CSV escaping and clone isolation.

The workspace tests cover exact large-number money, missing versus zero, consistent filtered rows, incomplete age-bucket totals, the last-administrator refusal, report author roles, safe CSV, accent-folded search and fixture references.

These are synthetic fixtures under Node's test runner. They are not repository tests and not proof that `task ci:verify` passes for any production change.

## Browser scenarios actually run

`tests/browser-qa.cjs` and `tests/browser-qa-workspace.cjs` drive headless Chromium over `file://` (1440 × 1000 desktop, 390 × 844 phone). Run them with `npm i playwright-core` and `CHROME=<path to chromium> node tests/<file>`.

### Operator data path — 25 of 25 passed

| Scenario                                           | Observed                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Models counts add up to rows listed                | `2 + 1 + 1 + 10 = 14`; 14 rows                                                                          |
| Press "Never built"                                | address gains `status=never`; 1 row                                                                     |
| Back, then Forward                                 | 14 rows, then 1 row                                                                                     |
| Select `customer_health_daily` in Lineage          | 6 of 17 nodes lit (itself, 4 upstream models, `Raw lake: records`); downstream `revenue_monthly` dimmed |
| Node kinds                                         | raw / model / missing only; 0 source-account, report, question or dashboard nodes                       |
| `legacy_rollup` (dynamic reference)                | marked "upstream not declared", no edge                                                                 |
| Select `churn_watch`                               | "Missing dependency: stg_churn_signals … the edge is kept"                                              |
| Delete `dim_customer`, reopen Lineage              | "Missing dependency: dim_customer" on `customer_health_daily`'s chain                                   |
| Division strip                                     | 7 divisions; lineage opens under Models                                                                 |
| Drive scope: untick a folder, review               | states the next complete read marks items outside the pick removed at source; nothing erased            |
| Gmail scope: untick a label, review                | states held messages stay live; not marked removed; nothing erased                                      |
| Journal with `source=gmail.support` in the address | 1 row, all of that mailbox                                                                              |
| Run `CASE-0101`                                    | "Scope at start: invoices, contacts, payments"                                                          |
| Same run as admin                                  | 2 count links; "1 now attributed to a later run"                                                        |
| Run `CASE-0100` (before scope was recorded)        | "Scope at start: —"                                                                                     |
| Same run as member, as viewer                      | 0 links in the counts table                                                                             |
| Sources as member, as viewer                       | 0 write plates                                                                                          |
| Sources as admin                                   | 15 write plates, per card state                                                                         |
| 390 px Lineage                                     | every upstream name listed as text                                                                      |
| Stylesheets                                        | 0 transition or animation rules without `steps()`                                                       |
| Dialogs                                            | 0 `dialog` / `role=dialog` elements                                                                     |
| Page errors / network requests                     | none / none                                                                                             |

r5b changes People only: the last administrator is offered no lower role and no Remove, a role saves on selection with no review step, withdrawing an invitation takes a second press that names the address, and the role rights sit beside the invitation form. The operator path was rerun unchanged: 25 of 25.

### Customers, Reports and People — 15 of 15 passed (r5b)

| Scenario                                     | Observed                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Business performance, all segments           | 654,302.25 SGD in range; last month 128,600.50                                                         |
| Services filter                              | 399,501.75 in range; last month 78,000.50; `segment=services` in the address                           |
| Back, then Forward                           | 654,302.25, then 399,501.75                                                                            |
| Atlas Example book                           | no Demo Co. report, model or source; lineage draws 0 nodes                                             |
| Lineage in any book                          | 17 nodes in Demo Co., 0 product, report or dashboard nodes                                             |
| Demo Operator, the last administrator        | "Last administrator" on the roster row and the page; 0 role selects, 0 Remove controls, 0 review steps |
| Demo Analyst made admin by choosing the role | saved in one step; Demo Operator then offers 1 role select and 1 Remove                                |
| Withdraw an open invitation                  | rows 1 → 1 after the first press → 0 after the second, which names the address                         |
| Invitation form                              | role rights table shown beside the form, not folded                                                    |
| Viewer on Reports                            | 0 authoring controls                                                                                   |
| Member on Reports and People                 | 1 authoring control; 0 invite controls                                                                 |
| Invite `new.person@example.test`             | members 3 → 3; open invitations 0 → 1 (after the withdrawal above)                                     |
| Customer index                               | 3 accessible customers                                                                                 |
| Page errors / network requests               | none / none                                                                                            |

The r3 pass recorded further Reports and People checks (chart point → result row, question-editor validation, unsupported SQL, fail-once save, new dashboard, create and rename a customer). The code behind them is unchanged in r5; they were not rerun here.

Screenshots in `screenshots/` were captured by the same browser at a viewport as tall as the page, so the phone division strip sits at the foot where it belongs. No screenshot was edited.

## Not verified / not claimed

- No real authentication, OAuth, Google Picker, connector read, SQL execution, dbt build, table drop or database write.
- The Xero and HubSpot scope statements are proposed wording only; the proposal commits to Drive and Gmail, which match the read's documented behaviour (ADR 0071).
- No physical device, screen reader, 200% zoom, reduced-motion runtime or contrast certification.
- Graph edges are declared fixtures. Editing SQL does not recompute lineage; the harness is not a SQL parser, and production lineage must come from the server's reading of each model's declarations.
- Large or paginated datasets, concurrent users and real cron previews are not modelled.

## Publication boundary

Nothing in this package has been posted anywhere by the harness. It makes no network requests.
