---
title: "Xero reporting with SQL and dbt: build your own views"
description: "Build custom Xero reporting with SQL and dbt: P&L, receivables ageing and cash views, using exact decimals and keeping missing amounts visibly missing."
translationKey: "xero-reporting"
pubDate: "2026-09-29"
tags: ["Xero", "dbt", "SQL", "BI"]
keywords: ["xero reporting", "xero custom reports", "xero dashboard", "xero bi", "xero dbt"]
hero: "../../../assets/posts/xero-reporting/hero.png"
heroAlt: "Xero reporting sketch showing invoices flowing into raw.records, dbt models and a dashboard bar chart"
---

Xero reporting becomes a modelling problem when your team needs its own account groupings, receivables buckets or cash views. A chart needs a definition of what each row means, which transactions belong in the total and how missing amounts affect the answer. SQL and dbt give engineers and finance teams a place to make those decisions explicit and reusable.

[Undercroft](https://github.com/muitneliss/undercroft) is an open-source data platform that lands source data in an immutable raw data lake, projects records into Postgres and runs user-authored dbt models. Its Reports division provides BI over those models. It is currently pre-alpha and ships no business schema: the P&L, receivables and cash models described here are designs you build, not installed Xero report templates.

## How does custom Xero reporting work with SQL and dbt?

The path is Xero data → raw data lake on S3 or MinIO → `raw.records` in Postgres → dbt models → BI. The lake is the durable layer; Postgres holds projections that can be rebuilt. That separation lets you revise reporting logic without treating the first interpretation of a source record as permanent.

The connector declares entities such as invoices, payments, credit notes, accounts, tracking categories, bank transactions, bank transfers and manual journals. The available data still depends on the connection's granted scopes and completed reads. A declared entity is not evidence that a particular tenant has received it.

For the ingestion side, see [connecting Xero to Postgres](/en/xero-integration-postgres/). For why transformation comes after landing the data, see the [ETL versus ELT workflow](/en/etl-vs-elt/). This post starts where those workflows leave you: deciding what the raw records should mean in a report.

## Which data do P&L, receivables and cash views need?

Start with the decision a reader wants to make, then define the grain: what one row represents. “One invoice” and “one invoice line” are different grains. Joining invoice totals to several lines and then summing those totals can multiply revenue without producing a SQL error.

| Custom view        | Candidate inputs to inspect                                               | Definition to agree first                               |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Management P&L     | Invoice lines, credit notes, accounts, bank transactions, manual journals | Period, account mapping, signs and included adjustments |
| Receivables ageing | Invoices, contacts, payments, credit notes                                | Reporting date, outstanding balance and overdue buckets |
| Cash movement      | Payments, bank transactions, bank transfers                               | Cash event, account scope and duplicate treatment       |

These are modelling starting points, not a promise of complete financial statements. In particular, the connector reads manual journals but does not read the `/Journals` system journal. An invoice-led management P&L therefore needs an explicit coverage review before anyone presents it as a complete ledger-derived result.

Write down the reporting currency too. Keep currencies separate unless the model explicitly converts them using dated rates. A column called `total` with no currency or conversion rule is not a sufficient reporting contract.

## How should you organise Xero dbt models?

Use staging for source-specific interpretation, intermediate models for reusable business calculations and marts for the rows reports consume. The names below illustrate a project you could author; Undercroft does not create these models automatically.

![dbt lineage diagram showing stg_invoices in staging, int_receivables in intermediate and fct_receivables in the mart](../../../assets/posts/xero-reporting/flow.png)

A staging model such as `stg_invoices` selects the source and entity, preserves record identifiers and exposes the fields you have actually inspected. Use dbt's `source()` for raw records and `ref()` for upstream models. Undercroft's model checker refuses direct table references in models because they hide dependencies from dbt.

An intermediate model such as `int_receivables` could apply agreed balance and ageing rules. A mart such as `fct_receivables` could then expose one row per invoice for the dashboard. Keep invoice-level balances separate from line-level analysis until the join's grain is clear.

The following SQL is illustrative. It assumes you have authored `int_receivables` with the named columns, one row per invoice, and a fixed-precision `amount_due`. It is not a shipped model or a query to run against unknown payload fields.

```sql
select
    currency,
    ageing_bucket,
    count(*) as invoice_count,
    count(*) filter (where amount_due is null) as missing_amounts,
    sum(amount_due) as known_amount_due
from {{ ref('int_receivables') }}
group by currency, ageing_bucket
```

The name `known_amount_due` matters: SQL sums the readable values even when some rows are missing amounts. Showing the missing count alongside that subtotal avoids presenting a partial answer as a complete balance. Decide separately whether an incomplete group should display any total at all.

## How do exact decimals and missing amounts change the report?

Undercroft's money contract uses strings at boundaries, `big.js` for application arithmetic and `numeric(18,4)` in Postgres. Monetary values must not pass through JavaScript `Number()` or `parseFloat()`. Fixed precision preserves decimal arithmetic within the configured scale; it does not recover precision already lost upstream.

The dbt `parse_amount` macro returns a fixed-precision value or `NULL` when it cannot read the amount. Use the macro supplied by `models.reference` rather than inventing a cast. An unreadable amount must not become zero through `coalesce(amount, 0)` or a similar fallback.

There are three different outcomes to communicate: a genuine zero, an unavailable value and a partial aggregate. `formatMoney` renders a missing amount as an em dash, and truncates the display to two decimal places while keeping the stored amount. A custom report still needs to preserve that meaning in its SQL and presentation.

Comparisons also distinguish `ok`, `mismatch` and `unverified`. Missing evidence or different currencies cannot establish agreement. During reconciliation, “nothing failed” is not enough if one side of the comparison was never available.

## How do you define a useful P&L and receivables ageing view?

For a management P&L, agree the period, account-to-report mapping and treatment of each included transaction type before aggregating. Keep unmapped accounts visible for review. Silently dropping them produces a cleaner table at the cost of an unexplained gap in coverage.

Use source identifiers to retain a route back to the records contributing to a result. Then compare a bounded period and currency with the finance team's reference, investigating differences by category. Decimal arithmetic prevents one class of error; it does not validate account mappings, signs or period selection.

For receivables, establish whether the request is for current outstanding amounts or a historical position. Today's invoice balance alone cannot establish what was outstanding at a previous month-end. A historical view needs evidence of the relevant changes and explicit reconstruction logic; keeping raw data does not automatically supply a ready-made ageing snapshot.

Define buckets against an agreed reporting date, and decide how unknown due dates appear. Leave those invoices in an identifiable missing-date group rather than classifying them as current. Test boundary examples such as due today, one day overdue and the first day of each later bucket.

## How can you build a cash view without counting money twice?

Treat a cash view as its own model. An invoice date, a payment date and a bank transaction date answer different questions. Inspect the actual records before choosing which date controls each cash movement.

The connector includes bank transactions and transfers as well as payments, giving your model more inputs than invoices alone. You must still define how related records match and which representation contributes to a total. Model internal transfers separately from external receipts and payments so the chosen cash measure has a clear account scope.

For an older connection, inspect which bank and journal scopes were granted. The repository describes missing grants explicitly; reconnecting can add access, but a successful run by itself does not prove that every input your cash view requires was collected.

## How do you check models and publish a Xero dashboard?

The model-builder skill starts with a brief, then reads the lake rather than guessing payload keys. Its workflow provides a useful sequence for Xero custom reports:

1. Agree the purpose, grain, sources, columns, filters and model name.
2. Inspect `lake.summary`, sample `lake.records` and review existing models and macros.
3. Draft the SQL, run `models.check`, resolve errors and review warnings and unverified items.
4. Approve the exact model before saving, then approve its build separately.
5. Inspect the build result, preview and failing rows before relying on the output.

Column tests support `unique` and `not_null`. A test failure does not stop the table from being built; failing rows are available through `dq.failures`. These checks help verify grain and required fields, but do not establish financial completeness.

Tenant-owned dbt macros let repeated expressions live in one place. Look for an existing macro before copying a classification or normalisation expression. Admins can author macros through CLI or MCP; the web model reference panel displays them read-only. A broken macro can fail the tenant's whole build because dbt parses the project, so check and review changes carefully.

Once models are built, Reports can save questions using SQL or a visual definition and arrange them on a dashboard with shared filters. Questions run as the tenant's read-only login over its analytics schema. For a Xero BI view, place coverage indicators beside financial charts so readers can see when an apparently precise number is incomplete.

## FAQ

### Does Undercroft include ready-made Xero custom reports?

No. It ships a connector and a modelling workflow, while your team authors the business schema and report definitions for its own P&L, receivables and cash views.

### Can I use SQL for a Xero dashboard?

Yes: built dbt models can feed saved SQL questions in Reports, which dashboards arrange into tiles. Model SQL uses `source()` and `ref()`; report SQL reads the built analytics tables.

### Will missing Xero amounts appear as zero?

The platform's amount parser returns `NULL` for unreadable amounts, and its money formatter shows missing values as an em dash. Your custom SQL must preserve that distinction and disclose incomplete aggregates.

### Can an AI agent build a Xero dbt model?

The published model-builder skill guides an agent through the brief, data inspection and model checks over MCP or CLI. Saving and building require the person's approval and the relevant permissions; a draft is not a successful build.
