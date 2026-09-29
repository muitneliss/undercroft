---
title: "MCP server for business data: AI with clear boundaries"
description: "An MCP server for business data helps AI agents work with Xero, Gmail and Drive. Understand permissions, reliable answers and when Undercroft fits."
translationKey: "ai-agent-mcp"
pubDate: "2026-09-29"
tags: ["MCP", "AI", "Integration", "Open-source"]
keywords:
  [
    "mcp server for business data",
    "mcp server",
    "ai agent data",
    "claude mcp xero",
    "chat with your data",
    "Undercroft",
  ]
hero: "../../../assets/posts/ai-agent-mcp/hero.png"
heroAlt: "Sketch of an MCP server for business data connecting an AI agent to Xero, Gmail and Drive data through Undercroft permission checks"
---

An **MCP server for business data** addresses a familiar problem: the information needed for a decision lives in several places. Finance checks Xero, operations searches Gmail, and supporting documents sit in Google Drive. An AI agent could help investigate across that information, but the business needs to know what it can see, what it can change, and where its answers come from.

Without those boundaries, a convenient conversation can create more review work than it saves. A convincing explanation may use an old report, miss an unread document, or confuse a sales opportunity with an invoice. Connecting an agent is useful only when the underlying evidence and the agent's authority are clear.

## What is an MCP server for business data?

MCP, short for Model Context Protocol, gives an AI application a shared way to discover and use another application's tools. Think of it as a service desk: the agent can ask for an available service, and the application decides whether that person may use it.

For business data, those services might include checking a sync, finding an existing model, or reading a report. The connection makes those actions available inside an AI conversation. It does not, by itself, collect your records, reconcile different sources, or decide what revenue means.

That distinction separates access from understanding. MCP provides a way to ask; your data platform supplies the evidence and rules behind the answer. Neither removes the need for someone to own the business definitions.

## How does Undercroft bring Xero, Gmail and Drive together?

Undercroft collects selected source data into an immutable raw data lake: a retained record of what arrived. Your team then defines dbt models that turn that material into information suitable for reports. The approach keeps source evidence separate from the interpretation used for analysis.

An agent works with information already collected by Undercroft. Connecting the agent does not also authorize access to a mailbox or choose which company's Xero records to collect. Source access remains a separate decision.

Once the information is available, an authorized agent can investigate collection status, discover models and read reports. A useful opening question is whether the relevant sources have been collected successfully. It establishes what evidence is available before asking why a business result changed.

Combining sources still takes judgment. A HubSpot deal and a Xero invoice may describe different stages of the same relationship, but they are not interchangeable measures of sales. Your team must define that relationship. The guides to [Xero reporting with dbt](/en/xero-reporting-sql-dbt/) and [preserving evidence in a raw data lake](/en/immutable-raw-data-lake/) explain those foundations.

## What can an AI agent read or change?

In Undercroft, the agent acts on behalf of a person. It faces the same application permission checks that govern that person's work. A connection can narrow those permissions further, but cannot make a viewer into an administrator.

For an initial evaluation, access limited to reading offers a useful boundary. The agent can use the available reading tools without permission to change things. This does not mean unrestricted access to every possible analysis: some operations involving the raw data lake require additional authorization.

You can withdraw a connected application's access. Also consider the person's full reach: the connection can cover the workspaces they belong to, rather than only the workspace they currently have open. Choosing whose account to connect is therefore part of choosing what information the agent may encounter.

## Can an email trick an AI agent into taking action?

An email or document can contain instructions, including instructions intended to mislead an AI agent. The important distinction is between material the agent reads and a request from the person using it. A sentence inside a supplier's email should not become permission to disconnect a source.

Undercroft's built-in assistant requires the person to confirm a proposed change. A separate AI check also assesses whether the person's own words requested that action, without using the retrieved material as evidence of permission. If that check is unavailable, the change is refused.

![The built-in assistant requires both human confirmation and an independent check of the person's request before allowing a change; a failed check blocks it](../../../assets/posts/ai-agent-mcp/flow.png)

This protection belongs to the built-in assistant. An external agent connected through MCP uses Undercroft's permissions together with the confirmation behavior of its own AI application. Teams should assess that application's behavior before allowing changes; the same connection protocol does not guarantee the same approval experience.

## How do agent skills help produce useful answers?

MCP supplies capabilities; skills supply working guidance. Undercroft's published skills teach an agent to inspect available evidence, clarify the person's request and respect refusals. They do not grant additional permissions, and connecting MCP does not necessarily load them.

For example, a model-building workflow helps an external agent clarify a business question and draft a dbt model, with approval before saving and building it. Its checks identify issues and uncertainty rather than certify the result as correct. An engineer still needs to review the logic. Teams whose agents work through a CLI can use that route with the person's application permissions as well.

Before relying on an answer, ask which sources and models support it, how recently they were updated, and whether any information is missing. A report reflects its last build, not necessarily today's source records. Missing amounts must stay missing, and amounts in different currencies need an explicit basis for comparison.

## When is this approach a good fit?

Undercroft fits teams that want AI-assisted investigation alongside retained source evidence and business definitions they control. It can reduce the work of navigating between tools while keeping access tied to existing responsibilities. As a self-hosted, open-source platform, it also gives the engineering team responsibility for operating the system.

It is a weaker fit if you expect connecting a chatbot to produce finished financial reporting without data preparation. It also needs careful evaluation when decisions require immediate source updates or no engineer is available to maintain models. A managed service or an existing BI workflow may suit those constraints better.

## How can you get started with Undercroft?

Explore [Undercroft](https://undercroft.lowbit.link) and its [open-source repository](https://github.com/muitneliss/undercroft), then use the [MCP setup guide](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/mcp-setup.md) for connection details. Evaluate a narrow question against evidence your team already understands, with access limited to reading, before expanding the agent's responsibilities.

## FAQ

### Can I use Claude with Xero data through MCP?

Yes, after Xero data has been collected into Undercroft. Claude can use the tools allowed by your permissions and the access you granted the connection.

### Does MCP replace data integration?

No, MCP gives an agent a way to use application capabilities. Data integration still brings the sources together, and models still define how to interpret them.

### Can I chat with business data without allowing changes?

Yes, you can limit the connection to reading tools. Some forms of analysis require further authorization, so this does not provide unrestricted access to the raw data lake.

### Does connecting an AI agent make reports accurate?

No, accuracy depends on source coverage, freshness and the business rules in your models. The agent should make those dependencies and any missing evidence visible.
