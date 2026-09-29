---
title: "Undercroft: an open-source data platform for self-hosted ELT"
description: "Explore Undercroft, an MIT-licensed open-source data platform combining ingestion, a raw lake, dbt and BI. Compare its scope with Fivetran and Airbyte."
translationKey: "open-source-data-platform"
pubDate: "2026-09-29"
tags: ["Open Source", "ELT", "Data Platform", "BI"]
keywords:
  [
    "open-source data platform",
    "fivetran alternative",
    "airbyte alternative",
    "self-hosted elt",
    "open source elt",
  ]
hero: "../../../assets/posts/open-source-data-platform/hero.png"
heroAlt: "An open-source data platform on your server, with APIs feeding connectors, a raw lake, Postgres, dbt and reports"
---

An open-source data platform should make it clear where your data lives, how it becomes a report, and which parts your team must operate. Undercroft brings ingestion, an immutable raw data lake, Postgres, dbt and first-party BI into one self-hosted stack. Its code is MIT-licensed, and its business models are yours to define.

That makes it worth considering as a Fivetran alternative or Airbyte alternative when you want to own the path from source to dashboard. It also comes with a significant qualification: the [Undercroft repository](https://github.com/muitneliss/undercroft) describes the project as **pre-alpha**, with nothing stable yet. Evaluate the actual sources and operating requirements before choosing it for a critical workflow.

## What does this open-source data platform include?

Undercroft connects several layers that a team might otherwise assemble separately. REST connectors read records, the raw lake preserves what arrived, Postgres makes that data queryable, dbt builds your analytical tables, and the Reports division displays saved questions and dashboards.

The repository ships YAML connector specs for Xero and HubSpot. Gmail and Google Drive use first-party collectors because retrieving document bytes needs more than a record-oriented YAML spec. Scripts can also send records through the lake write API, using the same create-only storage path.

The distinction is scope. An ingestion service may fit perfectly into an existing warehouse and BI setup. Undercroft supplies those adjacent modelling and reporting layers together, but still requires someone to define what the data means. It ships no business schema and no universal definition of a customer or revenue.

![Comparison of separate ingestion, storage, dbt and BI tools with connectors, a raw lake, Postgres, dbt and reports inside one Undercroft platform](../../../assets/posts/open-source-data-platform/flow.png)

This sketch compares ways to assemble a stack. It is not a claim that competing products lack integrations with the other layers.

## How does self-hosted ELT work in Undercroft?

The sequence is explicit in the repository's [architecture guide](https://github.com/muitneliss/undercroft/blob/main/docs/architecture.md):

1. A connector or collector obtains data from the source with the granted credentials.
2. The worker lands records or document bytes in the S3-compatible raw lake.
3. Records are projected into the generic `raw.records` table in Postgres; documents have their own catalogue and extracted-text projections.
4. The worker runs dbt with the tenant's models to build analytical tables.
5. Reports query those models through the tenant's read-only database login.

Business transformation follows landing, so teams can revise SQL without making the source API the only place to recover earlier observations. For a reporting workflow, that means separating “what did we receive?” from “how do we calculate this metric?”

This is useful when an operations team changes a grouping or finance revises a reporting rule. Retained raw data provides the input for rebuilding analytical projections. It does not supply missing records that the connector never collected, nor decide which accounting interpretation is correct.

## Where does the raw data live, and why keep it?

Undercroft's durable data foundation is its raw lake on S3 or MinIO. The documented server stack runs MinIO. Lake writes are create-only and content-addressed: identical content is deduplicated, and changed content receives a new version manifest rather than overwriting the previous one.

Postgres holds queryable projections. That separation matters because a table optimised for today's report need not be your only retained representation of a source record. A faulty model can be corrected while the landed input remains available.

Immutability also has a boundary. It describes the application's write path; it does not make a disk indestructible or automatically configure replication. The deployment runbook explicitly records that the raw lake is not in a backup set. A self-hosting team must plan object-storage durability and recovery instead of assuming a database dump protects the lake.

For the storage rationale, see the [immutable raw data lake guide](/en/immutable-raw-data-lake/). When comparing products, ask about destination data, temporary processing storage and retained source history separately. Those are three different questions.

## How does Undercroft compare with Fivetran and Airbyte?

Fivetran and Airbyte both centre their replication offerings on moving data from sources to destinations. Undercroft combines that ingestion work with its own raw lake, Postgres modelling environment and BI surface. The following comparison concerns that ELT workflow, rather than every adjacent product either vendor offers.

| Decision          | Undercroft                                                            | Fivetran                                                                      | Airbyte                                                                                      |
| ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hosting           | Self-hosted stack                                                     | Managed SaaS; hybrid processing is also available                             | Self-managed and managed offerings                                                           |
| Licence           | MIT for the Undercroft repository                                     | Commercial service                                                            | Core and connectors under ELv2; Protocol under MIT; commercial offerings have separate terms |
| Data location     | Raw lake on your configured S3/MinIO storage; projections in Postgres | Loads into your chosen destination; processing location depends on deployment | Loads into your chosen destination; execution location depends on deployment                 |
| Scope here        | Ingestion, raw lake, dbt and first-party BI                           | Data movement with transformation capabilities and integrations               | Source-to-destination replication within a broader product offering                          |
| Connector breadth | Xero and HubSpot specs; Gmail and Drive collectors                    | Hundreds of connectors                                                        | Hundreds of connectors                                                                       |

Fivetran's [deployment documentation](https://fivetran.com/docs/deployment-models) distinguishes SaaS processing from hybrid processing in your network. Calling it “cloud-only” would miss that option. Its [transformation documentation](https://fivetran.com/docs/transformations) also describes hosted dbt and transformation orchestration, so the comparison is not “Undercroft has dbt; Fivetran does not.”

Airbyte documents both [self-hosted and managed options](https://airbyte.com/why-open-source). Its [licence inventory](https://github.com/airbytehq/airbyte/blob/master/docs/community/licenses/README.md) distinguishes ELv2 components, the MIT-licensed Protocol and commercial products. Public source availability should not be treated as identical licensing across the whole stack.

Neither destination replication nor the presence of a raw table alone establishes the same create-only versioned archive as Undercroft's lake. Check the chosen connector, destination and retention behaviour instead of assuming one product owns your data and another does not.

## When are Fivetran or Airbyte the better choice?

Connector coverage is a strong reason to choose them. Fivetran describes [pipelines from hundreds of sources](https://www.fivetran.com/data-movement/hybrid-deployment), and Airbyte advertises a similarly broad catalogue. If your required source is already supported there, that can remove substantial connector implementation and maintenance work.

Fivetran's managed SaaS model is worth considering when the team wants the provider to run ingestion infrastructure. Airbyte is worth considering when self-managed replication and a broad connector ecosystem are the priorities. Both may fit a team that already has a warehouse, dbt workflow and preferred BI tool.

Undercroft is more relevant when its existing sources cover your needs and you want raw retention, SQL models and reports in one product. A missing connector is real work, even if the API looks simple. Authentication, paging, deletions and source-specific change tracking still need verification.

## Can you add a REST API connector without a new business schema?

For APIs that fit its connector contract, Undercroft describes the read in YAML. This real excerpt from `specs/connectors/hubspot.yaml` identifies the source and how bearer credentials are obtained; it is not a complete standalone connector:

```yaml
apiVersion: "undercroft.dev/v1"
kind: "Connector"
id: "hubspot"
displayName: "HubSpot CRM"
baseUrl: "https://api.hubapi.com"
auth:
  kind: "bearer"
  token: { from: "connection" }
  grantRefusal: "hubspot-missing-scopes"
```

The rest of the spec declares entities, pagination and other reading rules. Source records go into a generic table, so a new REST source does not require a new business-table migration. Making it available in the product still requires packaging the spec, exposing the supported source and releasing the change.

The [REST API and YAML connector guide](/en/data-integration-rest-api-yaml-connectors/) explains that boundary. Declarative connectors reduce repeated plumbing; they do not prove that an arbitrary API is supported.

## How do dbt and BI work for engineering and finance teams?

Engineers author dbt models that turn source payloads into useful tables. Finance and operations teams help define the meaning: which statuses count, which date determines a period, and how missing values should appear. The platform does not silently supply those decisions.

Database permissions separate the work. Each tenant has its own dbt login and analytical schemas. Row-level security restricts raw reads by tenant login. Reports run as a separate read-only BI login against that tenant's analytical schema; BI cannot directly read the raw schema. These boundaries are documented in [ADR 0018](https://github.com/muitneliss/undercroft/blob/main/docs/adr/0018-per-tenant-roles-and-row-level-security.md).

Reports are part of Undercroft itself, and Metabase is no longer in the stack. Members and admins author saved questions and dashboards; viewers read them. The [Xero SQL and dbt reporting guide](/en/xero-reporting-sql-dbt/) gives a concrete example of the modelling work between an API response and a useful report.

## What must your team operate when you self-host?

The documented deployment uses one Docker Compose stack on Dokploy, containing multiple services. The control plane is its only public surface. The worker, databases, MinIO and scheduler communicate internally; “one stack” does not mean one process.

Dokploy clones the server compose file from `main`, while releases supply published application images. Verification checks running image digests. A rollback changes image versions but does not automatically roll back that compose file, as the [deployment runbook](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/deployment.md) explains.

Your operating plan therefore needs owners for credentials, sign-in configuration, storage durability, upgrades and failed syncs. MIT licensing does not remove infrastructure costs or engineering time. For an open source ELT evaluation, test one representative source through one agreed report, including a failed run and recovery, before expanding the scope.

## FAQ

### Is Undercroft an open-source Fivetran alternative?

Yes, for teams evaluating a self-hosted path from supported sources through a raw lake, dbt and BI. It is MIT-licensed and pre-alpha, with much narrower connector coverage than Fivetran.

### Is Undercroft an Airbyte alternative for self-hosted ELT?

It can be when you want modelling and reporting in the same stack as ingestion. Airbyte remains a strong candidate when broad connector coverage and replication into an existing destination are the main requirements.

### Does Undercroft include ready-made business models?

No business schema ships with the platform. You write dbt models to define the analytical tables and calculations your team needs.

### Does self-hosting mean everything stays offline?

No: connectors still call external source APIs, and configured external services may make other outbound requests. Self-hosting gives you control over the deployed stack and its storage; it is not an air-gap guarantee.
