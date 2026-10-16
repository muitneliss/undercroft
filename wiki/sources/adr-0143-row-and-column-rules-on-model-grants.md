---
title: ADR 0143 Row and Column Rules on Model Grants
type: source
date: 2026-10-16
tags: []
source: docs/adr/0143-row-and-column-rules-on-model-grants.md
source_path: docs/adr/0143-row-and-column-rules-on-model-grants.md
source_hash: 4a30091133f7904216971cb7ab7a2b3212b362783cee0bc8012c71e30dd0375c
ingested: 2026-10-16
---

# ADR 0143 Row and Column Rules on Model Grants

# ADR 0143 Row and Column Rules on Model Grants

PR 4, the last of the four changes [[ADR 0139 Tenant Access Is Casbin Policy]] planned: a grant on one model may say which of its rows and columns it gives -- "the head of Sales sees only Sales's rows", "staff do not see `salary`" -- enforced by Postgres through the scope logins of [[ADR 0142 Object Reach and Scope Logins]].

**What a rule is.** A grant on `model:<name>` (`read`) may carry a `row_rule` -- one to ten conditions `{column, op: eq|in, values}`, ANDed -- and `hidden_columns` (`630_grant_rules.sql`, CHECKed: only on one model, never `model:*`, shape and bounds as `@undercroft/contracts/rowRules`). Saving the same grant again replaces its rules. At `grants.save` every column named must be one the model's last build found (`app.model.columns`) or the seed declares (`COLUMN_NOT_FOUND`); an `eq` of several values is refused (`RULE_SHAPE`).

**Union.** Rules add like grants: any reaching grant without a row rule, or `model:*`, is every row; otherwise a row meets any one grant's rule; a column stays hidden only when every grant hides it. Casbin decides whether a model is reached; `limitsOf` in `rbac.ts` computes how much, carried on the reach as `limits`. Built-ins hold `model:*` and are never narrowed.

**Refuse, not blank.** A scope login with hidden columns gets `SELECT (<visible columns>)`; a hidden column or `SELECT *` is refused (reworded `COLUMN_NOT_GRANTED`) and absent from `information_schema`/`bi.schema`; `models.list/get` and `seeds.get` leave it out. Visible columns are computed when the grant is written, so a column a later build adds is VISIBLE until hidden -- a deliberate deny-list trade-off.

**Row rules are RLS keyed on the login.** `ENABLE` (not `FORCE`: the dbt owner builds and tests) on a table some scope has a row rule on; `undercroft_open TO <BI login>, <unruled scopes> USING (true)`, an explicit list that fails closed; one policy per rule-bearing scope `TO` that login, `(<col> = ANY (ARRAY[<value>::<type>]) AND …) OR …`, built with `%I`/`%L` (`ops.row_predicate`). Typed comparison against `format_type` without a modifier (no `varchar(n)` truncation); literals are converted at CREATE POLICY under pinned settings, so a reader's `SET TimeZone` cannot move them; NULL never matches. Policies carry a fingerprint comment and are rewritten only when it differs (ACCESS EXCLUSIVE). A materialised view with a row rule is withheld.

**Broken rules fail closed.** A rule naming a missing column, or a value its type refuses, compiles to NULL and becomes `USING (false)` for that scope; the promotion still publishes. `ops.scope_faults` asks the same function against the live table, so `scopes.preview`'s `broken` and the enforcement cannot disagree; nothing is stored.

**Re-applied where PR 3 grants.** `raw.grant_staged_to_scopes` writes column grants and policies on the STAGED relation inside the promotion (`ops.apply_relation`), travelling through `SET SCHEMA`; a new rule set is a new hash and login, provisioned lazily; `provision_tenant` restates each relation once (`ops.apply_scopes`); the sweep's `DROP OWNED` takes a login out of policies.

**Hash v2.** No rules: `undercroft.scope/1;models=…` (existing logins keep their names); rules: `undercroft.scope/2;models=…;rules=<ops.scope_limits>`, canonical and sorted bytewise. The worker's lease key `scopeKey` reads the same set. Rule-bearing scopes use `/v1/queries/limited/{run,schema,export}` so an older worker cannot strip them; exports store `scope_limits` and download under the intersection.

**Subset rule.** Containment, sound not complete: each given rule implies one of the caller's (condition by condition, values among theirs) and it hides every column hidden from them; replacing or deleting a grant weighs what it gave, guarded in the writing statement (`GRANT_CHANGED`).

**Readers are told.** `scopes.preview` (self, or `people:manage`): permissions, every model reached with rows, hidden, broken, raw, reports. Answers name row-limited tables in `rowsLimited`; the lineage too; the assistant gets a scope summary. Out of scope: raw rows, view models, free-form predicates. How-to: [[Runbook: Access control]]; syntax: [[Permissions]].
