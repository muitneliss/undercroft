---
title: 'Runbook: Connecting an agent over MCP'
type: source
date: 2026-09-25
tags: []
source: docs/runbook/mcp-setup.md
source_path: docs/runbook/mcp-setup.md
source_hash: 02d1e3ce68b320a7c27a69a95fcf56d860d91dfe110ba6c8d3d6cd784c22e3af
ingested: 2026-09-25
---

# Runbook: Connecting an agent over MCP

# Runbook: Connecting an agent over MCP

How to connect Claude Code, Claude Desktop or any MCP client to `/mcp` on the control plane; the decisions are [[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]]. Today a client connects with a **personal access token**; Google sign-in from a claude.ai connector without a pasted token is ADR 0060's follow-up, and until it lands a client that cannot send a header cannot connect.

A token is the person's, not a customer's: it reaches what they reach in every customer they belong to, with their role in each, and dies at the next request once their access is removed. Each carries a grant: `read` (Chỉ đọc) is offered only tools `EFFECTS` in `surface.ts` classifies `read`; `write` (Đọc và ghi) everything the role allows. `lake_query` (admin SQL against the raw lake) is not a read, and every delete/revoke/disconnect is destructive; mint `read` unless the agent is meant to change things. A token lives 30, 90 or 365 days, is shown once, and cannot mint or revoke tokens -- only a browser session or the CLI can.

To mint one: click your address in the running head (`/account`), give a label, pick grant and expiry under "Personal access tokens", copy the `upat_…` value at once. The table lists each token's last use (to the minute) and a Revoke plate; a revoked or expired token gets 401 at its next call.

The URL is `<origin>/mcp`: `https://<control plane>/mcp` on a deployment; locally `http://localhost:5173/mcp` (Vite proxies `/mcp`, `task dev:run`), `http://localhost:3000/mcp` (the control plane directly) or `http://localhost:13000/mcp` (`task dev:up-all`). Claude Code: `claude mcp add --transport http undercroft <url> --header "Authorization: Bearer upat_…"` (`--scope user` for every project). Claude Desktop: `npx -y mcp-remote <url> --header "Authorization:${UNDERCROFT_AUTH}"` with `UNDERCROFT_AUTH=Bearer upat_…` in the server's `env`, since some platforms split an argument at its space.

`TOKEN=upat_… task dev:mcp-smoke URL=<url>` (`scripts/mcpSmoke.ts`) checks that no bearer gets 401 naming `resource_metadata`, lists the token's tools by effect (a read token must show 0 write, 0 destructive), and calls `session_me` to show whose token it is; the token rides the environment to stay off process lists.

The agent sees tools named by path with `_` for `.` (`runs_list`, `bi_questions_save`), each taking the procedure's own schema (`tenantId` for a tenant-scoped one), descriptions in the client's `Accept-Language` (Vietnamese by default), results whole in `structuredContent` with the text clipped to 50 items per list and 60 KB and a note saying so, and refusals with a `code` (the CLI's vocabulary), a sentence, facts and a `traceId`. Signing out, the health probe, the Google Picker configuration and the token procedures are not offered.

Troubleshooting: 401 on every call (revoked, expired, mistyped, or access removed; a browser cookie is never enough); a missing tool or `WRITES_DISABLED` (a read token); `NOT_FOUND` for a customer you can name (not a member -- confirms nothing); `PERMISSION_DENIED` (member without the role); `INTERNAL_ERROR` with a `traceId` (follow it with `task obs:trace TRACE=<id>` or the `debug-trace` skill); a JSON-RPC `-32602` naming the tool (not a tool this server offers). Every call is logged as `mcp_call { tool, via, credential, outcome }` with the token's id, never the token, arguments or result.
