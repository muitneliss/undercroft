---
title: 'Runbook: Access control'
type: source
date: 2026-10-23
tags: []
source: docs/runbook/access-control.md
source_path: docs/runbook/access-control.md
source_hash: aacf2ce4429e73a6385b8346b6533024d7e39d2fe3c323a0f13867a7de418aac
ingested: 2026-10-23
---

# Runbook: Access control

How a customer defines roles of its own, grants one permission or reading one thing to a role or a person -- on a model, only some of its rows or not some of its columns -- makes a grant expire, checks what someone can see, and takes access away -- in the web UI, the CLI and over MCP (`docs/runbook/access-control.md`). Why: [[ADR 0139 Tenant Access Is Casbin Policy]], [[ADR 0141 Custom Roles and Grants Under the Subset Rule]], [[ADR 0142 Object Reach and Scope Logins]], [[ADR 0143 Row and Column Rules on Model Grants]], [[ADR 0147 Each Division Reads Under Its Own Permission]]; syntax and bounds: [[Permissions]].

**Before you start.** Defining roles and grants needs `roles:manage`; reading grants and giving roles needs `people:manage`. The subset rule: you give or take away only permissions you hold and what you can read yourself -- someone reading only `fct_sales` cannot grant `model:*` nor invite at a built-in role. A built-in role reads everything; a role of the customer's own reads only what is granted (`model:…`, `raw:…`, `report:…`, or the wholes); roles defined before the change were given all three wholes. **What a role opens:** a role with no permission opens Customers and Reports alone, as a viewer does; Sources, the Journal, the Raw lake and Models each open on their own read permission (`sources:read`, `runs:read`, `lake:read`, `models:read`) in the browser, CLI and MCP alike. Reading a model's rows through Reports needs none of them, only a grant on the model.

**Web UI (People).** Roles: define (key, display name, description, permissions), edit, delete (refused while held or invited at). Members/Invitations: give or invite at a role. Grants: choose a role or person and a permission OR something to read (the wholes only if you read them, each model and reference table -- listed if you hold `models:read` -- each source and stream -- listed if you hold `lake:read` -- each question and dashboard), optional last day, counted to its end in the reader's own zone ([[ADR 0149 Times Are Shown in the Viewer's Zone]]); expired grants stay listed. Example: Sales sees only `fct_sales` and its dashboard -- a role with no permissions, a grant on the model, the dashboard and each of its questions; a tile not granted shows "not granted". For one model, if you hold `models:read`, the form offers **Only rows where** (column, equals / is one of, values one to a line) and **Hide columns**, and **They can see now** shows the subject's preview -- rows, hidden columns, broken rules. Grants add up; hiding is a list of what to hide, so a new column is visible until hidden; a broken rule shows no rows. Deleting a model or report takes its grants.

**CLI.** `roles save/delete`, `people set-role/invite`, `grants save --permission …` or `--object model:fct_sales|'raw:hubspot/*'|report:dashboard:<id>`, rules through `--input-json '{"rowRule":[…],"hiddenColumns":[…]}'`, `grants reach --role|--email|(self)`, `scopes preview --role|--email|(self)`, `grants list`, `grants delete --id`. **MCP:** the same with `_` (`grants_reach`, `scopes_preview` included).

**Refusals.** `PERMISSION_REQUIRED`, `PERMISSION_NOT_HELD`, `REACH_NOT_HELD`, `WHOLE_REACH_REQUIRED` (console, preview, test failures, model writes need `model:*` and `raw:*`), `OBJECT_NOT_FOUND`, `OBJECT_SHAPE`, `ONE_OBJECT`, `COLUMN_NOT_FOUND`, `RULES_NEED_ONE_MODEL`, `RULE_SHAPE`, `GRANT_CHANGED`, `COLUMN_NOT_GRANTED`, `ROLE_NOT_FOUND`, `NOT_MEMBER`, `ROLE_IN_USE`, `ROLE_TAKEN`, `BUILT_IN_ROLE`, `EXPIRY_PASSED`, the last admin. **Not yet:** rules on raw rows or view models, conditions other than equals and is one of.
