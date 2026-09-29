---
title: "Xero reporting: build reports your team can explain"
description: "Make Xero reporting reflect your business with shared definitions, reusable dbt models and visible data gaps. Learn where Undercroft fits and what it requires."
translationKey: "xero-reporting"
pubDate: "2026-09-29"
tags: ["Xero", "dbt", "BI"]
keywords:
  ["xero reporting", "xero custom reports", "xero dashboard", "xero receivables ageing", "xero dbt"]
hero: "../../../assets/posts/xero-reporting/hero.png"
heroAlt: "Xero reporting sketch showing source data flowing through a raw lake and models into a report"
---

Xero reporting becomes harder when the business needs answers that depend on its own definitions. Finance wants overdue balances, operations wants cash received, and management wants costs grouped around how the company works. If each team makes its own spreadsheet adjustments, meetings become arguments about whose total to trust. The problem is agreeing what the figures mean and applying that meaning consistently.

Custom reporting gives those decisions a shared home. Undercroft supports this approach by keeping source data, running business rules your team defines, and presenting the results through BI. It is an open-source platform in pre-alpha, with no ready-made financial reports. That makes it an option for teams prepared to own their reporting logic.

## What makes custom Xero reporting trustworthy?

A useful report connects a business question to a clear definition. “What do customers owe?” needs a reporting date, a treatment of payments and credits, and a decision about what counts as overdue. Without that agreement, a precise-looking total can answer a different question from the one the reader intended.

Think of the definition as a recipe. The ingredients are source records, the method is the calculation, and the finished dish is the report. Changing the chart cannot repair missing ingredients or an ambiguous method. Finance owns the meaning; engineering makes it repeatable.

Agree what each item being counted represents. An invoice and an invoice line are different things. Counting the full invoice amount again for every line can inflate a total even when the calculation runs successfully.

## How does Undercroft turn source data into reports?

Undercroft keeps collected Xero data in an immutable raw data lake, then makes it available for modelling in Postgres. Your team uses dbt to turn agreed business rules into reusable models: prepared datasets that reports can read. The built-in Reports area can present those models as saved questions, charts and dashboards with shared filters.

![Sketch showing source data passing through shared business rules to become a report](../../../assets/posts/xero-reporting/flow.png)

The separation matters when your understanding changes. You can revise a cost grouping and rebuild the reporting layer from the retained evidence. The original collected data remains separate from the interpretation. Keeping [raw data in an immutable lake](/en/immutable-raw-data-lake/) explains this principle; the [ETL versus ELT comparison](/en/etl-vs-elt/) explains why transformation can follow collection.

Repeated rules can be shared across models, reducing the chance that reports disagree because someone copied an old calculation. The trade-off is that changing a shared rule can affect several reports, so it needs review.

## Which business questions need different definitions?

Profitability, receivables and cash are related, but they describe different events. Treating them as variations of the same total hides decisions that readers need to understand.

| Business question    | Definition to agree                                    | Common source of confusion                                         |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| How did we perform?  | Period, account groupings and included adjustments     | A management view may omit parts of the ledger                     |
| What remains unpaid? | Reporting date, outstanding balance and overdue groups | Today's balance does not establish a past balance                  |
| What cash moved?     | Payment timing and which accounts are included         | Related payment records or internal transfers can be counted twice |

Undercroft's Xero connector includes invoices, payments, credits, bank activity and manual adjustments. It does not collect the complete system journal, so those inputs alone do not establish a complete ledger-derived financial statement. Check coverage before presenting a management report as one.

Availability also depends on the access granted and the data actually collected. A successful sync does not prove that every input a particular report needs has arrived. The [Xero integration overview](/en/xero-integration-postgres/) explains the collection side of that boundary.

## Why should missing money stay visibly missing?

A genuine zero means the amount is known. A missing amount means the evidence is unavailable or unreadable. Turning the latter into zero makes uncertainty disappear while leaving a reassuringly tidy total.

Undercroft uses decimal arithmetic for money and preserves unreadable amounts as missing. Your custom models must carry that distinction into the report. If only some amounts are available, label their sum as partial and show that records are missing, or withhold the total until the gap is resolved.

Currencies also need explicit treatment. Keep them separate unless the report defines a conversion using dated exchange rates. Accurate arithmetic cannot decide which rate or reporting period the business intended.

Reconciliation needs room for “not yet verified” as well as agreement and disagreement. A comparison without enough evidence has not passed simply because no difference was found.

## Can a dashboard prove the figures are complete?

A dashboard can make coverage visible, but it cannot establish completeness by displaying a result. Put unresolved records and missing information beside the financial measures. Review the result against a trusted finance reference and investigate differences before relying on it.

Undercroft supports model checks for repeated records and missing required values, but a built result can still have failed checks. Those checks help identify data problems; they do not certify the business definition.

Historical reporting needs particular care. Today's outstanding balance cannot by itself tell you what was owed at an earlier month-end. Retained raw data can support reconstruction only when it contains the relevant evidence and your models account for the changes. A data lake does not automatically provide historical receivables snapshots.

## When is this approach worth the work?

It fits when standard reports leave recurring business questions unanswered and finance can work with engineers who know SQL and dbt. The benefit is reusable definitions, a route back to source evidence and room to revise the interpretation as the business changes.

The cost is ownership. Someone must maintain the models, review shared calculations and investigate gaps. A self-hosted deployment also needs operational care. Undercroft's pre-alpha status adds change and uncertainty to that responsibility.

If existing reports already answer the question, extending the reporting stack may add little value. If you need finished financial statements immediately or have nobody to maintain custom models, this approach is unlikely to fit.

## How can you get started?

Choose a recurring question and agree what would make its answer trustworthy. Explore [Undercroft](https://undercroft.lowbit.link) and review the [project repository](https://github.com/muitneliss/undercroft) to assess its maturity and operating model. Use a small reporting scope to evaluate whether the available evidence and your team's capacity match the ambition.

## FAQ

### Does Undercroft include ready-made Xero reports?

No, your team defines the models and reporting rules. The platform provides data collection, modelling and BI, while finance decides what the results should mean.

### Can I build a custom Xero dashboard?

Yes, the built-in Reports area can arrange saved questions over your built models into dashboards. The useful starting point is a shared definition of the measure and its coverage.

### Can I report historical Xero receivables?

Only if the collected evidence supports the position at the requested date and your models reconstruct it. Current balances and a raw data lake alone do not guarantee that history.

### Can an AI agent help build Xero reports?

Undercroft's model-builder workflow guides an AI agent through understanding the request, inspecting data and checking a proposed model. Saving and building require approval and appropriate permissions; human review still determines whether the result answers the business question.
