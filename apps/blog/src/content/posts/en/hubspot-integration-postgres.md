---
title: "HubSpot integration: from CRM to Postgres and dbt"
description: "Build a HubSpot integration that syncs CRM objects and custom properties into a raw lake and Postgres, then joins HubSpot with Xero in dbt."
translationKey: "hubspot-integration"
pubDate: "2026-09-29"
tags: ["HubSpot", "Integration", "Postgres", "dbt"]
keywords:
  [
    "hubspot integration",
    "hubspot api",
    "hubspot to postgres",
    "hubspot data warehouse",
    "hubspot custom properties",
  ]
hero: "../../../assets/posts/hubspot-integration/hero.png"
heroAlt: "HubSpot integration sketch: contacts, companies and deals flow into a raw lake and Postgres, then a dbt join with Xero produces revenue by customer"
integration: "hubspot"
---

A HubSpot integration becomes useful for finance and operations when CRM records can be compared with accounting data. Undercroft reads contacts, companies, deals and chosen custom properties through the HubSpot API, preserves the observations in a raw data lake, and projects them into Postgres. Your dbt models can then join CRM with Xero to answer questions such as which customers have invoiced revenue behind their closed deals.

The boundary matters: Undercroft provides ingestion and a generic raw layer. You supply the customer mapping, revenue definition and analytical models. A successful sync does not automatically establish that two records describe the same customer.

## How does a HubSpot integration move CRM data into Postgres?

The path is HubSpot API → connector → raw lake → Postgres → dbt. The HubSpot connector is a YAML specification describing requests, authentication, pagination, properties and incremental behavior. A shared runtime executes it; the source definition is inspectable in the [Undercroft repository](https://github.com/muitneliss/undercroft).

Every observation enters through the lake's create-only, content-addressed write path. Postgres holds the projection that SQL can query, while the lake preserves the underlying versions. This separation lets you change an analytical model without treating a report table as the only surviving copy of source data.

Moving HubSpot to Postgres therefore does not create a ready-made business schema. Records enter the generic `raw.records` layer. Your dbt project turns their payloads into the tables your team needs. The [raw data lake architecture](/en/immutable-raw-data-lake/) explains that storage boundary, and the [guide to declarative REST API connectors](/en/data-integration-rest-api-yaml-connectors/) explains the configuration approach.

## Which HubSpot objects and relationships can you sync?

Contacts, companies and deals are the starting point, but the shipped connector also reads commerce objects and relationship data. Access depends on the private app's scopes.

| Data                            | What the connector reads                                         | Modeling use                           |
| ------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| Contacts                        | Names, email, company property, owner ID and timestamps          | Contact-level dimensions               |
| Companies                       | Name, domain, industry, lifecycle stage and owner ID             | CRM company dimensions                 |
| Deals                           | Name, stage, pipeline, amount, close date and owner ID           | Sales pipeline analysis                |
| Quotes, line items and products | Separate object streams                                          | Commercial detail                      |
| Owners and deal pipelines       | Owners, including deactivated ones; pipelines with stages        | Owner and stage labels                 |
| Associations                    | Deal-to-company and other supported links, with kinds and labels | Explicit relationships between records |

Use the association streams when a model needs relationships. A contact's company text is not a substitute for the contact-to-company links. Likewise, attaching a deal to a customer by matching names introduces an identity assumption the source relationship could have avoided.

Associations have another useful limitation: HubSpot does not supply their change timestamp in these responses. Their `source_updated_at` is therefore NULL. The connector does not manufacture one from the related deal's timestamp or from the moment it read the link.

## How do you connect the HubSpot API and choose custom properties?

HubSpot uses a private-app token in this integration. A HubSpot administrator creates it in the portal, and an Undercroft administrator adds it to the tenant's source. This connection does not use an OAuth consent screen.

1. Create a HubSpot private app and enable the read scopes for the required objects. The core scopes are `crm.objects.contacts.read`, `crm.objects.companies.read` and `crm.objects.deals.read`.
2. Open the tenant's Sources view in Undercroft, choose HubSpot and paste the access token. The worker checks it by reading one company before storing the sealed credential.
3. Use **Change what syncs** to select additional properties, including the portal's custom properties.
4. Press **Run now**, then inspect each entity in the Journal. Confirm that the streams your models depend on were actually read.

The standard property list is a floor: selections add properties and cannot remove the defaults. Companies, contacts, deals, quotes, line items and products can be widened. Owners, pipelines and associations have no property selection.

For widened objects, the list request identifies records and carries pagination; a subsequent batch read requests the union of default and selected properties in its POST body. This is how HubSpot custom properties can be included without putting an entire portal's property list into a query URL. Custom property selection does not imply support for arbitrary custom object types.

A missing scope skips the affected list and is named in the Journal while permitted lists continue. If no list can be read, the run fails. Check those messages before interpreting an absent column or stream as an empty business result.

## Does incremental sync avoid reading the whole HubSpot portal?

For contacts, companies and deals, the connector uses a client-side change filter. Every run still pages through the live list; the watermark decides which records need landing. An unchanged record remains part of the listing even if its payload is skipped.

This distinction affects API cost. A quiet CRM can still require many list requests, because incremental landing is not the same as asking the provider for fewer records. The connector uses object listing endpoints rather than the search endpoint with its per-query result cap.

The current configuration paces requests at 100 per minute and retries selected transient errors, including 429 responses, while respecting `Retry-After`. These are connector settings, not a promise about every HubSpot account's available quota or a guarantee of immediate completion.

HubSpot has no separate full re-sync control in Undercroft because its client filter already pages the whole source. Choose its sync schedule around the freshness you need and the cost of those listings.

## What happens when a record is deleted in HubSpot?

A complete live listing provides evidence of absence. After a qualifying listing finishes, a previously held record it no longer names is marked removed in Postgres through `deleted_at`. A dbt model that filters out removed rows then excludes it from active results.

![A deleted HubSpot record is absent from a complete listing, marked removed in Postgres and excluded from active dbt rows, while raw lake history is kept](../../../assets/posts/hubspot-integration/flow.png)

That decision requires the full listing. A failed, stopped or truncated read cannot establish removal. An empty listing also does not trigger mass removal: Undercroft refuses to infer that every record disappeared from a response it cannot trust as sufficient evidence.

Removal preserves the last payload and existing lake versions. The timestamp records when Undercroft noticed the absence, not the exact deletion time in HubSpot. A restored record named by a later complete listing becomes live again, even if the incremental filter skips its unchanged payload.

Relations declared as dependent on a parent are removed and restored with that parent. Merge information is available through `hs_merged_object_ids` on contacts, companies and deals. Your models can use that property when resolving identity after a merge.

There are timing limits. A record deleted between listing and batch fetching may only be marked removed on the next complete run. Removal markers are also projection state: rebuilding Postgres brings rows back as live until a later complete listing settles their status again.

## How can dbt join HubSpot with Xero for revenue by customer?

Start by defining a verified cross-system customer key. For example, your own mapping model could connect a HubSpot company ID to a Xero contact ID after review. A similarly spelled name is insufficient evidence, and an unmatched customer should remain visibly unmatched.

Next, define the accounting measure. A deal amount, invoice total and cash receipt answer different questions. Choose which Xero records and statuses count, how credits are handled, and which date defines the reporting period. Keep currencies separate unless your model applies an explicit dated conversion.

This illustrative dbt query assumes you have already authored both referenced models. They are not tables shipped by Undercroft; `net_revenue` represents your agreed accounting definition and uses decimal values.

```sql
select
  m.hubspot_company_id,
  r.currency,
  sum(r.net_revenue) as revenue
from {{ ref('customer_mapping') }} as m
join {{ ref('xero_revenue') }} as r
  on r.xero_contact_id = m.xero_contact_id
group by m.hubspot_company_id, r.currency
```

Before relying on this result, test that the mapping cannot multiply accounting rows and report unmapped IDs separately. The inner join above intentionally includes only mapped customers. Keep invalid or missing amounts distinguishable from zero. The [Xero integration guide](/en/xero-integration-postgres/) covers the accounting source, while [Xero reporting with SQL and dbt](/en/xero-reporting-sql-dbt/) develops the modeling side.

Freshness also differs between sources. Some Xero edits do not move the timestamp its change filter reads. Full re-sync is opt-in per Xero connection, happens during sync runs and uses a daily whole-read budget. When the budget runs out, the Journal can report waiting or paused lists even though the run succeeds. Do not assume the HubSpot data warehouse view and its accounting inputs reflect the same observation time.

## FAQ

### Can I sync HubSpot custom properties to Postgres?

Yes, select additional properties through **Change what syncs** for the six supported object types with property selection. The connector reads them alongside its required defaults, and your dbt models decide how to expose them as columns.

### Does this HubSpot integration run in real time?

It uses scheduled or manually triggered reads, so freshness depends on the sync schedule and completion. It does not promise an immediate downstream update for every CRM edit.

### Does deleting a HubSpot contact erase its raw data?

No: a qualifying complete listing marks it removed in the Postgres projection while retaining its payload and lake history. Models must apply the removal filter to exclude it from active results.

### Is a HubSpot-to-Xero revenue model included?

Undercroft supplies the raw data path and lets you author dbt models. You define and verify customer identity, revenue rules and currency treatment for your own business.
