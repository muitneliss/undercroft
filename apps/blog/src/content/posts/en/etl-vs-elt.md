---
title: "ETL vs ELT: which approach fits your reporting needs?"
description: "ETL vs ELT explained for business and engineering teams: compare the trade-offs, understand raw data retention, and see where Undercroft fits."
translationKey: "etl-vs-elt"
pubDate: "2026-09-29"
tags: ["ETL", "ELT", "Data integration", "dbt"]
keywords:
  ["etl vs elt", "what is etl", "what is elt", "etl pipeline", "elt pipeline", "raw data", "dbt"]
hero: "../../../assets/posts/etl-vs-elt/hero.png"
heroAlt: "ETL vs ELT sketch showing transformation before loading and an alternative that keeps raw data before transformation"
---

ETL vs ELT becomes a business question when a report needs to change. Finance may want a different definition of an active customer, while operations needs to examine orders individually instead of by month. If the data pipeline kept only yesterday's answers, answering today's questions can mean another extraction, another engineering request, or an explanation that the detail is gone.

The choice concerns when business rules are applied to data. Just as important is what survives those rules. Undercroft approaches this by keeping captured source data underneath the models used for reporting, so changing an interpretation does not have to mean collecting everything again.

## What does ETL vs ELT mean?

**ETL means extract, transform, load.** Data is collected from a source, prepared for a particular use, and then loaded into the place where people analyze it. Preparation might mean selecting relevant details, standardizing categories, or turning individual orders into monthly totals.

**ELT means extract, load, transform.** Data reaches the analytical environment before those business transformations happen. Teams then create models: organized views of the data that express the definitions their reports need.

Think of preparing a management briefing from interview notes. ETL resembles preparing the summary before delivering it; ELT resembles delivering the notes to the analysis team so it can prepare different summaries. Neither guarantees that the original notes will be kept. That is a separate decision.

The hero sketch illustrates ETL with raw data discarded and ELT with it retained. These are examples, not requirements: an ETL pipeline can also keep a raw archive.

| Question                            | ETL                                   | ELT                                |
| ----------------------------------- | ------------------------------------- | ---------------------------------- |
| When are business rules applied?    | Before the analytical load            | After the analytical load          |
| What arrives first?                 | Data prepared for an agreed purpose   | Source data for later modeling     |
| Where does a new definition belong? | In the preparation stage              | In the downstream models           |
| What makes recalculation possible?  | Retained inputs or another extraction | Retained inputs with enough detail |

## Why does the order matter when reports change?

Applying rules early can simplify life for report readers. They receive data prepared for an agreed purpose, and information that should not reach the destination can be removed beforehand. For a stable reporting requirement, that can be a sensible boundary.

The difficulty appears when preparation removes detail that later matters. Monthly totals cannot explain which orders were delayed. A stored label saying a customer is active cannot reveal the activity that produced that label. Reconsidering either answer requires the underlying evidence.

ELT gives teams room to interpret the same inputs differently. Operations can study fulfillment while finance uses another grouping for its own analysis. The benefit is flexibility, provided the required inputs were captured and someone owns the meaning of each model.

That ownership matters in both approaches. Loading data successfully does not prove a metric is correct, and a polished dashboard cannot resolve conflicting definitions on its own.

## How does Undercroft use ELT?

Undercroft is an open-source data platform built around preserving raw data before applying business definitions. Connectors read source systems and place captured data in a raw data lake. Existing captured content is not overwritten in place, and identical content does not need another stored copy.

Postgres makes the captured records available for analysis. Your team uses dbt to build models that express its business rules, then presents their results through reports and dashboards. The platform supplies the path from collection to analysis; your team supplies the meaning.

This separation is deliberate. Undercroft does not impose a standard business schema defining what every company's customer or invoice must mean. It suits teams whose reporting needs do not fit a universal template, but it also means useful business models require work.

The [data integration overview](/en/data-integration-rest-api-yaml-connectors/) explains the role of collection. The [immutable raw data lake explanation](/en/immutable-raw-data-lake/) describes why keeping the inputs is the foundation for rebuilding results.

## What happens when a business definition changes?

Imagine a team broadening its definition of an active customer to include people whose last order was further in the past. If it retained the relevant order details, it can revise the model and recalculate the answer. If it kept only the previous active label, it cannot recover those details from the label alone.

![A changed business rule feeds revised models and BI reports while the raw lake stays unchanged](../../../assets/posts/etl-vs-elt/flow.png)

In Undercroft, the raw lake holds the retained inputs; the analytical layers above it can be rebuilt. The diagram shows that dependency, not a requirement to discard every existing model whenever a rule changes. A revised definition still needs review against the business question.

This can reduce repeated collection work and make disagreement easier to investigate. Teams can compare interpretations of the same captured evidence. For a practical reporting context, see [Xero reporting with SQL and dbt](/en/xero-reporting-sql-dbt/).

## When is ELT a good fit, and when is it not?

ELT fits changing questions, shared sources, and teams able to maintain analytical models. ETL may fit better when the destination should receive only prepared data or when transformations must happen before data crosses that boundary. A system can use both patterns for different purposes.

Keeping more inputs brings storage, access, and retention responsibilities. It also does not preserve events the platform never observed: missing details, records deleted before collection, and changes between observations may remain unavailable. Retained history needs models designed to use it; it does not automatically become a historical report.

Undercroft's self-hosted approach also needs an operator, alongside people who maintain the models. It is currently pre-alpha, so teams requiring a stable managed service or ready-made business reports should weigh that mismatch carefully. Neither ETL nor ELT guarantees lower cost or faster analysis.

## How can you get started with Undercroft?

Start with a report whose definition has changed before, and identify the evidence needed to calculate it differently. Explore [Undercroft](https://undercroft.lowbit.link) and the [repository](https://github.com/muitneliss/undercroft) to assess the approach, then agree who would own collection, model definitions, and checking the results.

## FAQ

### Is ELT always better than ETL?

No; the right choice depends on where transformation belongs and what the destination should hold. ELT offers flexibility for downstream analysis, while ETL can deliver a deliberately limited, prepared dataset.

### Does ETL always discard raw data?

No; ETL can keep a separate raw archive. Recalculation depends on retaining sufficient inputs, regardless of the order of transformation and loading.

### Is dbt an ETL or ELT tool?

In Undercroft, dbt handles transformation after data has been collected and loaded. It builds analytical models and does not replace the connectors that read source systems.

### Can Undercroft rebuild reports without collecting data again?

It can rebuild the models behind reports when the necessary inputs have been retained and remain accessible. A new question that needs uncaptured data may require another extraction, and the source may no longer have it.
