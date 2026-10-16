---
title: 'Runbook: Access control'
type: source
date: 2026-10-16
tags: []
source: docs/runbook/access-control.md
source_path: docs/runbook/access-control.md
source_hash: 8922c2caa2a34ac5b3c751d4ba0725662c3f1a6c8ff6393fcd487bf9f51c1df7
ingested: 2026-10-16
---

# Runbook: Access control

# Runbook: Access control

How a customer defines roles of its own, grants one permission to a role or a person, makes a grant expire, and takes access away, in the web UI, the CLI and over MCP (`docs/runbook/access-control.md`). The decisions are [[ADR 0139 Tenant Access Is Casbin Policy]] and [[ADR 0141 Custom Roles and Grants Under the Subset Rule]]; the bounds are [[Permissions]].

**Before you start.** Defining roles and granting needs `roles:manage`; reading grants and giving someone a role needs `people:manage`; an admin holds both. The subset rule: you give, grant or take away only permissions you hold. Choose the smallest change -- an existing role, a grant for one more permission or one for a while, a new role when several people need the same set.

**Web UI (People).** *Roles*: the built-ins and the customer's own with what each holds and how many hold it; *Define a role* takes a key (fixed once created), a display name, an optional description and permission boxes (a box you do not hold is locked). *Edit permissions…* ticks a draft until *Save permissions* or *Cancel*; built-ins have no Edit. *Delete…* takes two presses and is refused while the role is held or named by an open invitation; its grants go with it. *Members* and *Invitations* pickers list every role, a custom one by label with its key. *Grants*: every grant including expired ones; *Grant a permission* picks a role or a roster person, a permission, and an optional last day, which holds until the end of that day in Singapore time; granting the same thing again moves its expiry. *Take away…* is two presses; removing a person removes their grants.

**CLI.** `undercroft roles list`, `roles save --key … --label … [--create] --input-json '{"permissions":[…]}'`, `roles delete --key … --yes`, `people set-role --role <key>`, `people invite --role <key>`, `grants save --email|--role … --permission … [--expires-at <ISO with offset>]`, `grants list [--email|--role]`, `grants delete --id … --yes`. A write needs a profile that allows writes; `--dry-run` first.

**MCP.** `roles_list`, `roles_get`, `roles_save`, `roles_delete`, `grants_list`, `grants_save`, `grants_delete`, beside `people_setRole` and `people_invite`; writes need a write grant. The `undercroft-access-control` skill turns a sentence into one of these and asks first ([[Runbook: Agent skills]]).

**Refusals.** `PERMISSION_REQUIRED` (lack the procedure's own permission), `PERMISSION_NOT_HELD` (the subset rule, listing what you lack), `ROLE_NOT_FOUND`, `NOT_MEMBER` (invite first), `ROLE_IN_USE` (counts of holders and open invitations), `ROLE_TAKEN`, `BUILT_IN_ROLE`, `EXPIRY_PASSED`, and the last-admin `CONFLICT` (a custom role never counts as admin).

**Not yet.** Grants on one model, raw source or report, and row or column rules, are later releases.
