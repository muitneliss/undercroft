# 20. BI is first-party in the control plane; Metabase leaves the stack

- Status: Accepted
- Date: 2026-09-19
- Supersedes: the stack listing in [ADR 0008](0008-deploy-on-release-from-ci.md) (Metabase
  as the second public surface) and, for BI alone, the "invoked dependency in its own
  container" category [ADR 0003](0003-typescript-monorepo-on-bun-with-trpc.md) put it in
- Extends: [ADR 0018](0018-per-tenant-roles-and-row-level-security.md), whose per-tenant
  login is what every question here runs as

## Decision

The Reports division of the control plane is the BI. A question is a visual definition the
server compiles to SQL, or SQL written in the editor; it is drawn by one of sixteen chart
types on Chart.js; a dashboard puts saved questions on a twelve-column grid under shared
filters whose values live in the URL. Every question runs through the worker as the
tenant's own read-only login (`undercroft_bi_<slug>`), in a read-only transaction with a
statement timeout, so a customer's SQL can reach only that customer's `analytics_<slug>`.
Members and admins author; viewers read what was made for them.

Metabase and its own Postgres are removed from both compose files, with the
`undercroft-bi.lowbit.link` domain and `UNDERCROFT_METABASE_PG_PASSWORD`. The platform's
`undercroft_bi` role stays, for an operator's external SQL client; it is not what the product
uses.

## Why

The operator holds many customers' case books and switches between them mid-call. Two
applications with two navigations, two sign-ins and two ideas of "a dashboard" is the
strangeness that surface cannot afford, and it is why the user asked for one front end.

Metabase could not be that front end. Verified against its documentation (2026-09): the
open-source and Starter editions embed dashboards as guest views — an unsigned token, locked
parameters, no exploring. The query builder, drill-through, full-app embedding and the React
SDK need Pro or Enterprise with JWT single sign-on, and every viewer needs a Metabase
account. So either a customer's members could not author anything, or every one of them
became a licensed seat on a second system whose permissions we would have to keep in step
with `app.tenant_member` by hand — a second owner of who may see what, which
[ADR 0018](0018-per-tenant-roles-and-row-level-security.md) exists to prevent.

Running the questions as the tenant's login extends that ADR's property from writes to
reads: a compromised control plane still holds no tenant's database credential, because
only the worker mints one, and holds it for one pooled session.

## Options rejected

- **Metabase open source, embedded as guest views.** Viewers could look and not ask; a
  member would still author in Metabase's own interface, which is the second navigation.
- **Metabase Pro with JWT SSO.** An account per viewer, a licence, and permissions mirrored
  by hand into a system that does not know what a tenant is.
- **Keep Metabase for the operator alone.** Two definitions of a dashboard in one product,
  and a public surface kept alive for a handful of readers who have the Reports division.

## What it costs

A chart set is ours to maintain, and it is bounded on purpose: what the sixteen types cannot
draw, a question's table can print. A dashboard runs one query per tile; twelve tiles is
twelve round trips through the worker on every filter change, and a batched answer is a
later addition. There is no drill-through; a tile links to its question. Series colour
follows rank, not entity, across filter changes. Money is never a float on a chart: the
number that positions a bar is a `Big` converted once, under one recorded suppression, and
every figure a reader can read is printed from the original digits.
