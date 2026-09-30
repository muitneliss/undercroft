---
title: "Raw data lake: keep the evidence behind your reports"
description: "A raw data lake preserves captured inputs so reports can be rebuilt. Learn how Undercroft approaches it, what you gain, and when it fits your team."
translationKey: "raw-data-lake"
pubDate: "2026-09-29"
tags: ["Data lake", "Architecture", "ELT"]
keywords:
  [
    "raw data lake",
    "data lake",
    "immutable data",
    "data lake vs data warehouse",
    "raw data retention",
    "rebuild reports",
  ]
hero: "../../../assets/posts/raw-data-lake/hero.png"
heroAlt: "Sketch of a raw data lake supporting Postgres, dbt models, and dashboards that can be rebuilt"
---

A raw data lake keeps the source material behind your reports, so changing a calculation does not mean losing the evidence it depends on. That matters when a finance lead questions a total, operations changes a performance measure, or an engineer discovers a reporting mistake. A dashboard can show the answer your team calculated. It cannot recover information you discarded along the way.

Business applications also change. A record may be corrected, an attachment removed, or access to a source withdrawn. Asking the application for the same information later may produce a different answer. Keeping what you captured gives your team a basis for revisiting decisions, provided the relevant material is still retained.

## What is a raw data lake?

A raw data lake holds captured source material before it is shaped for a particular report. Think of an archive of incoming documents beside a working spreadsheet. The spreadsheet expresses today's interpretation; the archive lets you return to the material when the interpretation changes.

The distinction is about purpose. The lake preserves inputs, while reporting turns them into useful answers. A field that seems irrelevant today may support a question next quarter, as long as it was collected and kept. You do not have to predict every future report before preserving its possible inputs.

Raw does not mean complete. A lake cannot contain a version that the connector never collected, and it cannot recreate information the source had already removed. The [guide to data integration](/en/data-integration-rest-api-yaml-connectors/) explains how that collection boundary shapes what becomes available for analysis.

## Why keep raw data when reports already exist?

Imagine an operations team changing how it defines overdue work. Its existing report groups some cases incorrectly. If the captured records contain the necessary information, the team can revise the rule and calculate the results again.

Now imagine that only a monthly total was kept. That total cannot explain which individual cases were included, and a fresh download may reflect later edits. The team has lost the basis for checking its earlier answer.

Preserving inputs separates a correctable reporting mistake from irreversible information loss. It also gives engineering and business teams a common starting point: they can discuss how to interpret the same retained material. Agreement still takes work, but it need not depend on reconstructing a missing history.

## How does Undercroft preserve the original data?

Undercroft treats the raw lake as the data foundation that must survive. Captured material enters storage without replacing earlier captured versions. Postgres makes the retained information available for analysis, and your dbt models define how it becomes useful for the business.

The lake can use S3 or MinIO. The choice affects where your team operates storage; the central idea stays the same. Reports depend on preserved inputs, and the analytical data above them can be rebuilt from what remains in the lake, together with the processing and report definitions.

Undercroft saves incoming data progressively during collection. If a sync stops, material already saved does not depend on the rest of that run finishing. This limits what is left unprotected in a running process, without promising recovery of anything that had not yet reached storage.

## Does storing the same document again waste space?

Undercroft recognises identical content and shares its stored copy. If the latest content from the same source record arrives unchanged, it does not add another historical version just because another sync ran.

Where content appeared remains a separate fact. The same attachment in different messages can share storage while each occurrence keeps its source context. This avoids confusing “the same document” with “the same business event”.

![Identical documents from email and a shared folder share storage in the raw lake, retain their source context, and feed models and a report](../../../assets/posts/raw-data-lake/flow.png)

This comparison requires exactly identical content. Documents that look alike are not necessarily identical files, and sharing storage does not decide whether business records are duplicates. Your reporting rules still need to make that judgement.

## How is a data lake different from a data warehouse?

A data lake preserves inputs; a data warehouse organises information for analysis. They serve complementary purposes. In Undercroft, Postgres and user-authored dbt models provide the analytical layer, without imposing a ready-made business schema.

| Reader's question                     | Raw lake                                 | Analytical layer                     |
| ------------------------------------- | ---------------------------------------- | ------------------------------------ |
| What does it keep?                    | Captured source material and its context | Information shaped for reporting     |
| What happens when definitions change? | Retained inputs remain available         | Models and results can be revised    |
| Who gives the data business meaning?  | Collection preserves the evidence        | Your team defines the interpretation |

That makes model ownership part of the decision. Undercroft does not know what your organisation should count as an active customer or a completed case. The [ETL versus ELT comparison](/en/etl-vs-elt/) explores the wider choice of shaping data before or after loading it.

## When does an immutable data lake fit your team?

This approach fits teams whose reporting definitions evolve, whose source applications change, and who need to revisit captured evidence. It is especially useful when losing the input would be more costly than recalculating a report.

The trade-offs are practical:

- Retained history consumes storage even when unchanged content is reused.
- Rebuilding analytical data takes time and computing resources; some recovery paths can also lead to renewed source reads.
- A self-hosted deployment needs people to maintain storage, control access, and plan recovery.
- Business definitions still need owners who can develop and review the models.

It may not fit a team that only needs a current snapshot, can easily obtain the inputs again, and has little use for historical evidence. It is also a poor match if you expect finished business reports without modelling work. Preserving material creates options; it does not supply the interpretation automatically.

## Does immutable storage mean keeping everything forever?

Immutable means an existing captured version is not silently replaced. Retention is a separate decision about which history stays available. Undercroft reports the historical observations it removes under retention rules, so that loss of history is visible.

Reducing retained history does not necessarily reclaim the same amount of storage immediately, because content may be shared. Nor does immutability replace backups or protect against every infrastructure failure. Decide what evidence the business needs to keep and what recovery effort it can accept.

## How can you get started with Undercroft?

Choose a report whose changing definitions have caused repeated work, and identify the source material needed to recalculate it. Explore [Undercroft](https://undercroft.lowbit.link) and its [open-source repository](https://github.com/muitneliss/undercroft) to assess the approach with your team. The useful starting question is whether keeping those inputs would make the next correction easier to explain and deliver.

## FAQ

### Is a raw data lake a backup?

It preserves captured inputs for reuse and analysis, but it is not a complete backup of the source application. The lake's own storage still needs protection and a recovery plan.

### Can a raw data lake recover deleted source data?

It can provide a retained copy if the material was captured before deletion. It cannot recover something never collected or no longer retained.

### Can I query a raw data lake with SQL?

Yes. In Undercroft the raw data is also available in Postgres, so an administrator can explore it with SQL before anyone has modelled it, and your team's models turn it into the analytical tables reports read. The lake keeps the original material both are built from.

### Does a raw data lake make reports accurate?

It preserves inputs that help you check and revise reports. Accuracy still depends on collection coverage, source quality, and the business rules used in your models.
