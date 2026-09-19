---
title: Tenant ID
type: concept
date: 2026-09-19
tags: []
source_count: 0
---

# Tenant ID

The tenant ID is `ops.tenant.id`: the one identifier a customer has. It is the
value `.claude/rules/pii.md` calls a **CASE-id**, and the two names refer to the
same column. There is no second identifier.

The UI used to label it "Mã tham chiếu" / "Reference" and describe it as "a
CASE-id", which read as though a CASE-id were a further thing alongside the
tenant ID an operator already had. It is not. The field is now labelled
"Mã khách hàng" in Vietnamese and "Tenant ID" in English.

## Why the value must be a code, not a customer name

The tenant ID does not stay in the control plane. `lakeKeyOf` in
`packages/contracts/src/rawRecord.ts` builds every raw object key as
`records/{source}/{tenantId}/{entity}/{sourceRecordId}`, and that key is stored
in `raw.documents.lake_key`. That table is granted to `undercroft_dbt`, so the
key is one `dbt run` from a dashboard — see [[ADR 0005 The Role and Grant Model]].
A real client name typed into this field therefore lands in an S3 prefix, a
directory name, and BI-visible output.

`TenantId` in `apps/control-plane/src/handlers/router.ts` enforces the shape
`^[A-Za-z0-9][A-Za-z0-9_-]*$`, which also keeps spaces and slashes out of a
value that becomes a path segment. `CASE-0001` remains the placeholder.

## Why it cannot be changed

The raw lake is create-only and content-addressed: an object already written
cannot be overwritten, moved or renamed, and raw is the only layer that cannot
be recomputed — [[ADR 0001 Raw Lake Is the Only Durable Layer]]. Changing a
tenant ID after data has landed would leave every existing object under the old
prefix while new data went to the new one, splitting one customer into two
disjoint sets of data with nothing to reconcile them.

So `tenants.rename` takes no tenant ID in its input at all. Leaving it out of
the procedure's shape makes the change impossible to ask for rather than merely
refused.

## What *is* changeable: the display name

`ops.tenant.display_name` is the human-readable label. It reaches no object key
and no lake path; it lives in that column and nowhere else, so it carries none
of the constraints above.

Until `tenants.rename` existed, `tenants.create` was the only writer of
`ops.tenant` and a mistyped display name was permanent by accident rather than
by design. The procedure is `requireRole("admin")` — tenant-scoped, unlike
`tenants.create`, which is platform authority per
[[ADR 0013 Superadmins Named in the Environment]]. Creating a customer and
retitling an existing one are different authorities on different axes.

Note that `ops.tenant` is granted `SELECT` to `undercroft_bi`, so the display
name is visible to dashboards. That is allowed — `pii.md` governs tracked files
and lake keys, not this database column — but it is not a private field.
