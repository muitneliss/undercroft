---
title: 'Runbook: Onboarding a new person'
type: source
date: 2026-09-27
tags: []
source: docs/runbook/onboarding.md
source_path: docs/runbook/onboarding.md
source_hash: 886aa1787975ef55943460560c84ea4f0cc3d1833e48f85ca65fc71d23c5423e
ingested: 2026-09-27
---

# Runbook: Onboarding a new person

The order of steps that takes a new person from no access to an AI agent working in Undercroft, in Vietnamese first and English second; commands stay in the runbooks it links, so each how-to keeps one owner.

**1. Invite.** Sign-in is invite-only: an admin invites the exact email address from the customer's People page and picks a role -- `viewer` (sees sources, runs, models, reports), `member` (also saves report questions and dashboards), `admin` (also reads the raw lake, saves and builds models, connects sources, invites). Building models needs `admin`. With nobody yet able to invite, see "Bootstrap the first admin" in the sign-in runbook.

**Three words on the Reports page.** A *model* is a dbt `SELECT` over the raw data built into a table; the logic (joins, deduplication, time zones, what a metric means) lives there, and it changes only when built -- after each successful sync or when an admin builds it. A *question* (câu hỏi) is a saved query over the built models, from the form or as SQL, plus how to draw it as a table or chart -- what other BI tools call a saved query, a chart or a Look; the name is kept from Metabase, the BI Undercroft used before its own. It runs each time it is opened, so it is as fresh as the model's last build and no fresher; keep it thin (pick, filter, group, sort one model) and move logic a second question would copy into a model. A *dashboard* is saved questions on a grid under shared filters.

**2. Sign in once on the web**, with Google or an emailed code, to prove the invitation matches before any agent is involved.

**3. Pick a door by where they use AI.** claude.ai or Claude Desktop: a custom connector for `<control plane>/mcp`, signing in and choosing a grant on the consent page -- tools only, since Claude hosts do not read skills over MCP yet ([[Runbook: Connecting an agent over MCP]]). Claude Code: add the MCP server, then install the skills ([[Runbook: Agent skills]]). Codex or another terminal agent: install the skills; the skill installs the CLI and walks sign-in ([[Runbook: The undercroft CLI]]).

**4. Start read-only.** Choose Read only (or mint a `read` token) for the first days, so the agent is offered only read tools; reconnect with a write grant to save models or reports or trigger a sync. Every connection and token is revoked on the account page, effective at the next call.

**5. A first session.** Suggested prompts: check a customer's syncing and failing sources; count open deals, their total and how many have no amount; build a deals model for a weekly report, which the skill turns into an interview, a checked draft, and a question before saving and again before building. Three habits: ask how many rows were missing whenever an amount is summed (missing is not zero); after a sync, have the agent check the run and the model rebuild it started; send any `traceId` an error carries to the admin.
