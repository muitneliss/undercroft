# Connecting an agent over MCP

Undercroft answers the Model Context Protocol at `/mcp` on the control plane: every procedure
the web UI uses, offered as a tool to claude.ai, Claude Desktop, Claude Code or any other MCP
client, under the same role gates as the browser. ADR 0060 and ADR 0061 record the decisions;
this is how to use it.

A client connects in one of two ways:

- **By signing you in** (OAuth). You give the client the URL and nothing else; it sends you to
  Undercroft's own sign-in page -- Google or an emailed code, the same invite-only gates as the
  browser -- and then to a consent page where you choose **read only** or **read and write**.
  This is how a claude.ai connector connects, and the easiest way for Desktop and Code.
- **With a personal access token** you mint and paste. For a client that can send a header but
  not open a browser, or a script.

Both reach exactly what you reach in the browser, both carry a read or write grant, and both
are revoked on the account page.

## Connecting by signing in

The client needs only the URL (see [The URL](#the-url)). What happens next is the same
everywhere:

1. The client registers itself with Undercroft (automatic; you see nothing).
2. A browser opens on Undercroft's sign-in page, with a line saying an app is asking for access.
   Sign in with Google or with a code, using the address you were invited with.
3. The consent page names the app, the host it will send you back to, and your address. Choose
   **Chỉ đọc / Read only** unless you mean the agent to change things, then **Cho phép / Allow**.
   **Từ chối / Deny** sends the client away with nothing.
4. The browser returns to the client, which now holds an access token (8 hours) and a refresh
   token, and renews it without asking you again.

The app appears on your account page under **Ứng dụng đã kết nối / Connected apps**, with the
grant you chose. **Revoke** there stops it at its very next call and it cannot renew itself; to
let it back in, connect again from the client.

### claude.ai

Settings, then **Connectors**, then **Add custom connector**. Name it (`Undercroft`), paste
`https://<your control plane>/mcp` as the URL, leave the OAuth client fields empty, and add it.
Click **Connect** on it; the sign-in and consent above open in a new tab.

### Claude Desktop

Settings, then **Connectors**, then **Add custom connector**, with the same URL. Desktop opens
your browser for the sign-in and consent. (The `mcp-remote` configuration under
[Claude Desktop with a token](#claude-desktop-with-a-token) still works if you prefer a token.)

### Claude Code

```sh
claude mcp add --transport http undercroft https://<your control plane>/mcp
```

Then `/mcp` inside a session, choose `undercroft`, and **Authenticate**; Claude Code opens the
browser and listens on `localhost` for the return. Add `--scope user` to have it in every
project.

### When signing in does not connect

| What you see                                                 | Why, and what to do                                                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No access" on the sign-in page                              | The address is not invited, exactly as in the browser. Ask an administrator, and sign in with the invited address.                                    |
| the client reports `invalid_redirect_uri` at registration    | It registered a `http://localhost` callback as a web application. MCP SDK 2.x clients register it as native; update the client.                       |
| `403` with `insufficient_scope`                              | You (or the client) granted neither read nor write. Revoke the app on the account page and connect again, choosing a grant.                           |
| no sign-in is offered at all; `/.well-known/…` answers `404` | The control plane's public URL is plain HTTP on a non-loopback address, where MCP does not allow OAuth. Serve it over HTTPS, or use a personal token. |
| too many registrations, `429`                                | Registration is limited to five a minute per address. Wait a minute.                                                                                  |

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

## Claude Code with a token

```sh
claude mcp add --transport http undercroft https://<your control plane>/mcp \
  --header "Authorization: Bearer upat_…"
```

`claude mcp list` should show it connected; `/mcp` inside a session lists its tools. Add
`--scope user` to have it in every project rather than this one.

## Claude Desktop with a token

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
- **Widgets.** In a host that draws MCP Apps (claude.ai, Claude Desktop), a query result
  (`lake_query`, `lake_search`, `lake_records`, `lake_documents`, `bi_answer`, `bi_runQuestion`,
  `bi_questions_answer`) is drawn as a table, up to 500 rows, amounts printed digit for digit;
  `runs_trigger` and `runs_get` draw the run, followed live until it ends. A host without the
  extension shows the same answer as text.

Not offered at all: signing out, the health probe, the Google Picker's configuration, and the
account procedures themselves (tokens and connected apps).

## Troubleshooting

| What you see                               | Why, and what to do                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` on every call                        | The token is revoked, expired or mistyped, or your access was removed. Check the account page; mint a new one. A browser cookie is never enough: `/mcp` reads only `Authorization: Bearer`.                                                                                                                                      |
| the client fails after working for a while | Usually its access token expired and the client did not renew it. An operator finds the refused requests with `task obs:search FOR=status=401 SINCE=6h` and why each was refused with `task obs:logs FOR=mcp_refused SINCE=6h`; see [Why a bearer was refused](#why-a-bearer-was-refused). The client itself is told only `401`. |
| a tool the UI has is missing               | A `read` token is not offered writes. Mint a `write` token if you mean to allow them.                                                                                                                                                                                                                                            |
| `WRITES_DISABLED`                          | The same, for a client that called a write it was not offered.                                                                                                                                                                                                                                                                   |
| `NOT_FOUND` for a customer you can name    | You are not a member of it -- the same answer the browser gives, so it confirms nothing.                                                                                                                                                                                                                                         |
| `PERMISSION_DENIED`                        | You are a member, without the role. The sentence names the role needed.                                                                                                                                                                                                                                                          |
| `INTERNAL_ERROR` with a `traceId`          | Follow it: `task obs:trace TRACE=<id>`, or hand the id to the `debug-trace` skill. The server logs one `mcp_call` line per call, with the tool, the token's id and the outcome.                                                                                                                                                  |
| a `-32602` error naming the tool           | The name is not a tool this server offers: a typo, or a procedure that is not offered at all.                                                                                                                                                                                                                                    |

Every call is logged as `mcp_call { tool, via, credential, outcome }`: the token's `upat_…` id,
never the token, and never the arguments or the result.

### Why a bearer was refused

A client refused at the door gets the same `401` whatever the cause, or a `403` for
`insufficient_scope`, by design (ADR 0062): a caller holding a dead token is not told how it
died. The server logs the cause instead, one line per refusal:
`mcp_refused { status, refusal, reason, credential }`, with the request's `traceId`.
`credential` is the `upat_…` id or `oauth:<clientId>` when one was proven, the same id the
client's `mcp_call` lines carry, and never the token.

| `reason`             | What happened, and what to do                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `expired`            | The token ran out. A personal token: mint a new one. An OAuth client should renew its access token by itself; one that does not needs fixing. |
| `revoked`            | The token was revoked, or the app on the account page. Mint a new token, or connect the client again.                                         |
| `no_person`          | The credential is fine, but its person no longer has access. An administrator invites them again.                                             |
| `missing`            | No `Authorization: Bearer` at all. Every OAuth client's first contact looks like this, so it is logged at `info`, not `warn`.                 |
| `malformed`          | Not a token this server could read: usually a truncated or mangled header value.                                                              |
| `unknown`            | Not a token this server issued for `/mcp`: mistyped, from another server, or for another resource.                                            |
| `insufficient_scope` | The person granted neither read nor write. Revoke the app and connect again, choosing a grant.                                                |

To find them: `task obs:search FOR=status=401 SINCE=6h` lists the refused requests with their
trace ids, `task obs:logs FOR=mcp_refused SINCE=6h` lists the reasons, and
`task obs:logs FOR=<credential>` shows when that credential last worked. The `debug-trace`
skill walks through it.
