---
title: 'Runbook: Access control'
type: source
date: 2026-10-16
tags: []
source: docs/runbook/access-control.md
source_path: docs/runbook/access-control.md
source_hash: ec5c722d95bdb856d1779704fdf16329d4efdd6ad1a03c3ccf1c2cfe0b56ad78
ingested: 2026-10-16
---

# Runbook: Access control

# Runbook: Access control

How a customer defines roles of its own, grants one permission or reading one thing to a role or a person, makes a grant expire, checks what someone reaches, and takes access away -- in the web UI, the CLI and over MCP (`docs/runbook/access-control.md`). Why: [[ADR 0139 Tenant Access Is Casbin Policy]], [[ADR 0141 Custom Roles and Grants Under the Subset Rule]], [[ADR 0142 Object Reach and Scope Logins]]; syntax and bounds: [[Permissions]].

**Before you start.** Defining roles and grants needs `roles:manage`; reading grants and giving roles needs `people:manage`. The subset rule: you give or take away only permissions you hold and what you can read yourself -- someone reading only `fct_sales` cannot grant `model:*` nor invite at a built-in role. A built-in role reads everything; a role of the customer's own reads only what is granted (`model:…`, `raw:…`, `report:…`, or the wholes); roles defined before the change were given all three wholes.

**Web UI (People).** Roles: define (key, display name, description, permissions), edit, delete (refused while held or invited at). Members/Invitations: give or invite at a role. Grants: choose a role or person and a permission OR something to read (the wholes only if you read them, each model, source, stream, question, dashboard), optional last day in SGT; expired grants stay listed. Example: Sales sees only `fct_sales` and its dashboard -- a role with no permissions, a grant on the model, the dashboard and each of its questions; a tile not granted shows "not granted". Deleting a model or report takes its grants.

**CLI.** `roles save/delete`, `people set-role/invite`, `grants save --permission …` or `--object model:fct_sales|'raw:hubspot/*'|report:dashboard:<id>`, `grants reach --role|--email|(self)`, `grants list`, `grants delete --id`. **MCP:** the same with `_` (`grants_reach` included).

**Refusals.** `PERMISSION_REQUIRED`, `PERMISSION_NOT_HELD`, `REACH_NOT_HELD`, `WHOLE_REACH_REQUIRED` (console, preview, test failures, model writes need `model:*` and `raw:*`), `OBJECT_NOT_FOUND`, `OBJECT_SHAPE`, `ONE_OBJECT`, `ROLE_NOT_FOUND`, `NOT_MEMBER`, `ROLE_IN_USE`, `ROLE_TAKEN`, `BUILT_IN_ROLE`, `EXPIRY_PASSED`, the last admin. **Not yet:** row and column rules.
