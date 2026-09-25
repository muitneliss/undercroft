---
title: 'Runbook: Connecting an agent over MCP'
type: source
date: 2026-09-25
tags: []
source: docs/runbook/mcp-setup.md
source_path: docs/runbook/mcp-setup.md
source_hash: 8d4a358a708795186cab1f28843810645c1cec1ff143c847929827e43261d152
ingested: 2026-09-25
---

# Runbook: Connecting an agent over MCP

# Runbook: Connecting an agent over MCP

How a person connects claude.ai, Claude Desktop, Claude Code or any MCP client to `/mcp` on the control plane, which offers every web-UI procedure as a tool under the browser's role gates ([[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]], [[ADR 0061: An MCP client signs its person in, and draws two widgets]]).

**Two ways in.** By signing in (OAuth): the client needs only the URL, registers itself, opens Undercroft's own sign-in page (Google or emailed code, invite-only) and a consent page where the person picks read only or read and write; the client then holds a 15-minute access token and a refresh token. Or with a personal access token (`upat_…`) minted on `/account` and pasted into a header. Both reach exactly what the person reaches, both carry a grant, both are revoked on the account page (Connected apps / Personal access tokens); revoking stops the client at its next call.

**Per client.** claude.ai and Claude Desktop: Settings, Connectors, Add custom connector with `https://<control plane>/mcp`, then Connect. Claude Code: `claude mcp add --transport http undercroft <url>/mcp`, then `/mcp` and Authenticate; with a token add `--header "Authorization: Bearer upat_…"`. Desktop can also use `mcp-remote` with the header through `env`.

**URLs.** Deployment `https://<control plane>/mcp`; local `http://localhost:5173/mcp` (Vite), `:3000` (control plane), `:13000` (Path A).

**Tokens.** read vs write per `EFFECTS` in `surface.ts` (`lake_query` and every delete/revoke/disconnect are not reads); at most a year; shown once; cannot mint or revoke tokens. `task dev:mcp-smoke` checks the 401 challenge, the tool list split by effect, and whose token it is.

**What the agent sees.** Tool names are paths with `_` for `.`; descriptions in the client's language (vi default); results whole in `structuredContent`, text clipped to 50 items/60 KB with a note; refusals carry a code, sentence, facts and traceId. In hosts that draw MCP Apps, query results render as a table (up to 500 rows, amounts digit for digit) and `runs_trigger`/`runs_get` as a live run status. Account procedures, sign-out, health and the Picker config are not offered.

**Troubleshooting.** OAuth: "No access" = not invited; `invalid_redirect_uri` = a loopback callback registered as a web app (update the client); 403 `insufficient_scope` = neither grant chosen (revoke and reconnect); `/.well-known` 404 = public URL is plain HTTP off loopback; 429 = five registrations a minute. Tokens: 401 = revoked/expired/mistyped or access removed (a cookie never works); missing tools or `WRITES_DISABLED` = read token; `NOT_FOUND` = not a member; `PERMISSION_DENIED` = role; `INTERNAL_ERROR` = follow the traceId with `task obs:trace`; `-32602` = unknown tool. Every call logs `mcp_call { tool, via, credential, outcome }`, never arguments or results.
