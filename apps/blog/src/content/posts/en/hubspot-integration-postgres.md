---
title: "HubSpot integration: connect sales to revenue reporting"
description: "A HubSpot integration can connect CRM and accounting for clearer reporting. Learn how Undercroft preserves source data and where your team's judgment matters."
translationKey: "hubspot-integration"
pubDate: "2026-09-29"
tags: ["HubSpot", "Integration", "Reporting", "ELT"]
keywords:
  [
    "hubspot integration",
    "hubspot to postgres",
    "hubspot revenue reporting",
    "hubspot custom properties",
    "hubspot xero integration",
  ]
hero: "../../../assets/posts/hubspot-integration/hero.png"
heroAlt: "HubSpot integration sketch showing CRM and Xero data flowing through a raw lake and Postgres into customer revenue reporting"
integration: "hubspot"
---

A HubSpot integration becomes valuable when the business needs to connect sales activity with financial results. A closed deal tells you something different from an invoice or a payment. Bringing CRM and accounting data together helps teams investigate those differences without rebuilding a spreadsheet whenever someone asks a new question.

Undercroft reads HubSpot data, preserves it in a raw data lake and makes it available in Postgres for analysis. Your team defines how customers match across systems and what each measure means. That division matters: moving data creates the basis for a report, but it does not settle the business rules behind it.

## What business problems can a HubSpot integration solve?

Sales may want to understand which accounts progress through the pipeline. Finance may want to compare closed business with invoiced revenue. Operations may need to investigate why a customer appears in one system but cannot be found in another.

These questions become harder when every report starts with separate exports. Someone must repeat the matching, remember which version they used and explain why this month's calculation differs from last month's. A shared analytical foundation makes those choices reusable and open to review.

It also keeps disagreements visible. An unmatched customer or missing amount should remain a question to resolve, rather than disappear into a convincing total. The value is a clearer basis for decisions, not simply another dashboard.

## How does moving HubSpot data into Postgres help?

Think of the raw data lake as the source material and the report as an interpretation. You keep what was collected so that changing the interpretation does not destroy the material it relied on. Postgres provides the working space, while dbt models describe your team's reporting rules.

This is an ELT approach: collect and load the data before shaping it for a particular analysis. Undercroft preserves the versions it receives in the lake instead of overwriting them with the latest report. Your team can revisit its models as definitions change, using the source observations already collected.

That history covers what the integration has observed; it is not a promise to recover every change that happened before or between reads. The [guide to immutable raw data lakes](/en/immutable-raw-data-lake/) explains why preserving observations matters, and the [ETL versus ELT comparison](/en/etl-vs-elt/) explores when transforming later is useful.

## Which HubSpot data can you use for reporting?

The connector reads contacts, companies and deals, along with supported commercial details such as quotes, products and line items. It also reads sales ownership, pipeline stages and supported relationships between records. Those relationships help explain which company or contact a deal belongs to.

Custom properties can add business context to supported records. A team might need its own account classification to make a report meaningful. Selecting extra properties does not, however, mean that every custom object type is supported.

Access depends on the permissions granted in HubSpot. Undercroft identifies data it could not read while allowing permitted reads to continue. A successful run can therefore still be incomplete for your reporting purpose: check that the data your analysis depends on was actually available.

## How fresh will HubSpot reporting data be?

Undercroft reads HubSpot on a schedule or when a run is requested. For contacts, companies and deals, it reviews the current list and uses reported changes to decide which records need saving. Reviewing the list still takes work even when little has changed.

The practical trade-off is between freshness and the time and API capacity needed to read the source. A quiet but large CRM can still take time to sync. This approach suits reporting that can tolerate a delay; it does not promise an immediate downstream update after every sales edit.

Reports combining sources need an additional check. HubSpot and Xero may have been observed at different times, and some accounting edits need a whole-source re-read to be caught. Those re-reads can be deferred to keep their workload bounded, so a completed run alone does not establish equal freshness.

## What happens when someone deletes a HubSpot record?

Undercroft uses a qualifying complete read to notice that a previously known record is missing. It marks that record as removed in Postgres, while keeping its collected history in the raw lake. Your models must take removal into account when producing reports about currently active records.

![A complete HubSpot read identifies a missing record, Postgres marks it removed and the model excludes it from active results while the raw lake keeps its history](../../../assets/posts/hubspot-integration/flow.png)

An interrupted read cannot prove that a record disappeared. An empty result also does not cause Undercroft to declare everything removed. This caution reduces the risk of turning a reading problem into a false business conclusion, but means some deletions take longer to appear in reports.

The recorded removal reflects when the absence was noticed, rather than the exact moment of deletion in HubSpot. After rebuilding the analytical copy from the lake, another complete source read is needed to establish which records are still active.

## Can HubSpot and Xero produce a reliable revenue report?

They can provide the inputs, but your team must agree on customer identity and revenue meaning. Similar company names are insufficient evidence of a match. Unmatched customers need to remain visible, and the matching process must avoid counting the same accounting activity more than once.

The measures also need clear boundaries:

- Deal value describes a sales opportunity or agreement.
- Invoiced revenue describes an accounting view with agreed treatment of credits and reporting dates.
- Cash received describes payment activity, which may happen in a different period.

Missing amounts must remain distinguishable from zero. Different currencies should remain separate unless your team chooses an explicit conversion rule. The [Xero integration overview](/en/xero-integration-postgres/) explains the accounting input; these business definitions remain your responsibility.

## When is this approach a good fit?

Undercroft fits teams that want retained source data and control over their reporting logic, with engineering capacity to build and maintain models. It is especially useful when CRM needs to be analysed alongside other systems and the business expects its questions to change.

It is a weaker fit if you need ready-made revenue reports, automatic customer matching or immediate updates. Teams choosing a self-hosted platform also need someone to operate it. If HubSpot's existing reports answer the question, another data platform may add unnecessary work.

## How can you get started?

Choose a reporting question, agree on what its answer should mean and identify the data it needs. Then explore [Undercroft](https://undercroft.lowbit.link) and share the [HubSpot setup guide](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/hubspot-setup.md) with the person responsible for connecting the source. Review a small report together before expanding its scope.

## FAQ

### Can I sync HubSpot custom properties to Postgres?

Yes, additional properties can be selected for supported HubSpot record types. Your models decide how those values appear in reports; arbitrary custom object types are not implied.

### Is the HubSpot integration real time?

No, it uses scheduled or requested reads. Freshness depends on when a run starts and how long it takes to complete.

### Does deleting a HubSpot contact erase its raw history?

No, detecting removal preserves the history already collected in the raw lake. Models must account for removal to exclude that contact from active results.

### Does Undercroft include a HubSpot-to-Xero revenue model?

No, Undercroft provides the data foundation for models your team authors. Customer matching, revenue definitions and currency treatment must reflect your business.
