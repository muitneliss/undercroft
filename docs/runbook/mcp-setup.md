# Connecting an agent over MCP

Undercroft answers the Model Context Protocol at `/mcp` on the control plane: every procedure
the web UI uses, offered as a tool to Claude Code, Claude Desktop or any other MCP client, under
the same role gates as the browser. ADR 0060 records the decisions; this is how to use it.

Today a client connects with a **personal access token**. Signing in with Google from a
claude.ai connector, without pasting a token, is the follow-up ADR 0060 describes; until it
lands, a client that has no way to send a header cannot connect.

## What a token is

A token is **yours**, not a customer's. It reaches exactly what you reach in the browser -- every
customer you are a member of, with the role you hold in each -- and never more. Removing your
access removes your tokens' at the next request.

Each token carries a **grant** you choose when you mint it:

| Grant                | The agent is offered             | The agent can                                         |
| -------------------- | -------------------------------- | ----------------------------------------------------- |
| `read` (Chỉ đọc)     | only the tools classified `read` | look at runs, the lake, models, reports, people       |
| `write` (Đọc và ghi) | every tool your role allows      | also trigger runs, save and delete, invite and remove |

What counts as a read is `EFFECTS` in `apps/control-plane/src/handlers/surface.ts`. Two things
that look harmless are **not** reads: `lake_query` runs SQL an admin wrote against the raw lake,
and every `*_delete` / `*_revoke` / `*_disconnect` is destructive. Mint `read` unless you mean the
agent to change things: an agent reading a customer's mail can be talked into acting by it.

A token lives at most a year (30, 90 or 365 days), is shown **once**, and cannot mint or revoke
tokens itself -- only your browser session (or the CLI, which signs in the same way) can.

## Minting one

1. Sign in, and click your address in the running head. That is the account page, `/account`.
2. Under **Token truy cập cá nhân / Personal access tokens**, give it a label that says where it
   will live ("Claude Code on my laptop"), pick the grant and the expiry, and mint it.
3. Copy the `upat_…` value now. It is not shown again; if it is lost, mint another and revoke
   this one.

The table below the form lists your tokens with when each was last used (to the minute) and a
**Revoke** plate. A revoked or expired token gets `401` at its next call.

## The URL

`<origin>/mcp`, where the origin is the one you sign in at:

| Where                                | URL                                |
| ------------------------------------ | ---------------------------------- |
| a deployment                         | `https://<your control plane>/mcp` |
| local, `task dev:run` (Vite, Path B) | `http://localhost:5173/mcp`        |
| local, the control plane directly    | `http://localhost:3000/mcp`        |
| local, `task dev:up-all` (Path A)    | `http://localhost:13000/mcp`       |

## Claude Code

```sh
claude mcp add --transport http undercroft https://<your control plane>/mcp \
  --header "Authorization: Bearer upat_…"
```

`claude mcp list` should show it connected; `/mcp` inside a session lists its tools. Add
`--scope user` to have it in every project rather than this one.

## Claude Desktop

Desktop reaches a remote server with a header through `mcp-remote`. In
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "undercroft": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<your control plane>/mcp",
        "--header",
        "Authorization:${UNDERCROFT_AUTH}"
      ],
      "env": { "UNDERCROFT_AUTH": "Bearer upat_…" }
    }
  }
}
```

The header goes through `env` because some platforms split an argument at its space. Restart
Desktop after editing the file.

## Checking it works

```sh
TOKEN=upat_… task dev:mcp-smoke URL=http://localhost:3000/mcp
```

It checks the three things a client meets first: that `/mcp` without a token answers `401`
naming its `resource_metadata`, that the token lists tools (counted by what they may do -- a
`read` token must show `0 write, 0 destructive`), and whose token it is (`session_me`). Give the
token as an environment variable, as above, so it stays off every process's command line.

## What the agent sees

- **Tool names** are procedure paths with `_` for `.`: `runs_list`, `bi_questions_save`,
  `lake_search`. The input is the procedure's own schema; a tenant-scoped tool takes `tenantId`
  (`tenants_list` names yours).
- **Descriptions** are in the language the client asks for (`Accept-Language`), Vietnamese by
  default.
- **Results** are whole in `structuredContent`; the text beside it shows at most 50 items of any
  list and 60 KB, and says when it was cut.
- **Refusals** carry a `code` -- the CLI's vocabulary -- a sentence, any facts the server named,
  and a `traceId`.

Not offered at all: signing out, the health probe, the Google Picker's configuration, and the
token procedures themselves.

## Troubleshooting

| What you see                            | Why, and what to do                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` on every call                     | The token is revoked, expired or mistyped, or your access was removed. Check the account page; mint a new one. A browser cookie is never enough: `/mcp` reads only `Authorization: Bearer`. |
| a tool the UI has is missing            | A `read` token is not offered writes. Mint a `write` token if you mean to allow them.                                                                                                       |
| `WRITES_DISABLED`                       | The same, for a client that called a write it was not offered.                                                                                                                              |
| `NOT_FOUND` for a customer you can name | You are not a member of it -- the same answer the browser gives, so it confirms nothing.                                                                                                    |
| `PERMISSION_DENIED`                     | You are a member, without the role. The sentence names the role needed.                                                                                                                     |
| `INTERNAL_ERROR` with a `traceId`       | Follow it: `task obs:trace TRACE=<id>`, or hand the id to the `debug-trace` skill. The server logs one `mcp_call` line per call, with the tool, the token's id and the outcome.             |
| a `-32602` error naming the tool        | The name is not a tool this server offers: a typo, or a procedure that is not offered at all.                                                                                               |

Every call is logged as `mcp_call { tool, via, credential, outcome }`: the token's `upat_…` id,
never the token, and never the arguments or the result.
