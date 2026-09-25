# 62. A refused bearer is logged with its reason, and an access token lives eight hours

- Status: Accepted
- Date: 2026-09-25
- Supersedes: one sentence of
  [ADR 0061](0061-an-mcp-client-signs-its-person-in-and-draws-two-widgets.md), "Access tokens
  live 15 minutes". The rest of ADR 0061 stands, the refresh token included.
- Extends: [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md)'s "one log line per call" to
  the requests that never become a call, and
  [ADR 0058](0058-requests-are-traced-into-the-hosts-otel-lgtm.md)'s trace search to a status
  that is not an error.

## Context

On 2026-09-25 a Kanna MCP client connected to a production `/mcp` over OAuth. Its calls worked
for about ten minutes, every one logged as `mcp_call` under its `oauth:<clientId>`, and then the
person saw failures. We could not find them:

- `/mcp` wrote nothing when it refused a bearer. Only a request that passed authentication got
  as far as `mcp_call`.
- A 401 is not an error span. Only a 5xx marks a span failed, so `task obs:search FOR=errors`
  did not list it, and the search had no other way to ask.
- The client, the Claude CLI inside Kanna, never showed the `x-trace-id` its 401 carried.

Even had we found the requests, nothing said why they were refused. The chain beneath the door
collapsed every cause into one answer: `accessTokens.admit` and `McpAuth.admit` returned `null`
for unknown, expired, revoked and "person gone" alike, and `bearerContext` turned that into
`invalid_token`. That was deliberate for the client, which ADR 0060 answers with one uniform
challenge, and it had become the operator's answer too.

The likeliest cause is that an access token lived 15 minutes, and Kanna reads its bearer once,
when it spawns a session, and reuses it for every later turn. Fifteen minutes in, every call is
a 401. Kanna is being fixed separately; this records Undercroft's side.

## Decision

### Every refused bearer is logged, with a reason the client is never told

The bearer chain carries the refusal up as a value, `{ reason, credentialId? }`, instead of
collapsing it. Each layer names the reasons it can decide, and nothing else:

| `reason`             | Decided in                                                    | Means                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing`            | `resolveBearer` (`handlers/context.ts`)                       | No `Authorization: Bearer`. Also every OAuth client's first contact, before it has signed in.                                                                               |
| `malformed`          | `verifyAccessToken` (`handlers/mcpAccessToken.ts`)            | Not a signed JWT at all, or a verified one that names no client.                                                                                                            |
| `unknown`            | `accessTokens.admit`, `verifyAccessToken`, `resolveBearer`    | Not a credential this server issued for `/mcp`: no such token, a bad signature, another issuer, audience or type, a DPoP-bound JWT, or no authorization server here at all. |
| `expired`            | `accessTokens.admit`, `verifyAccessToken`                     | A real credential past its expiry.                                                                                                                                          |
| `revoked`            | `accessTokens.admit`, `McpAuth.admit` (`handlers/mcpAuth.ts`) | A personal token revoked, or an OAuth app whose consent was deleted ("Revoke" on `/account`).                                                                               |
| `no_person`          | `McpAuth.admit`, `bearerContext`                              | A live credential whose person has no account (Better Auth) or no `app_user` (the shared tail) any more.                                                                    |
| `insufficient_scope` | `resolveBearer`                                               | A live OAuth token whose person granted neither `undercroft:read` nor `undercroft:write`.                                                                                   |

`/mcp` writes one line per refusal:

```json
{
  "at": "…",
  "level": "warn",
  "component": "control-plane",
  "event": "mcp_refused",
  "traceId": "4bf92f35…",
  "status": 401,
  "refusal": "invalid_token",
  "reason": "expired",
  "credential": "oauth:k7Qm2Xa9…"
}
```

- **`credential` only where it is proven**: the `upat_…` id of a personal token whose row was
  found by digest, or `oauth:<clientId>` from a JWT whose signature verified. It is the same id
  the client's `mcp_call` lines carry. The `upat_` prefix of a token nobody holds is text the
  caller wrote and is not reported, and neither is anything read from an unverified JWT. The
  token, and any part of its secret, is never logged.
- **An expired JWT still names its client, because its payload is proven.** jose 6.2.12's
  `jwtVerify` checks the signature (`verifyCompact`) before it validates any claim, and
  `validateClaimsSet` checks `typ`, the required claims, the issuer and the audience before it
  throws `JWTExpired` for `exp`. The library's own declaration says that "token authentication
  precedes claim validation". So the payload a `JWTExpired` carries is one this server signed
  for `/mcp`.
- **`level` is `warn`, except `missing`, which is `info`.** A dead credential is a client
  failing. A missing one is also how every OAuth client learns to sign in, and a warning on
  every first contact would be a warning nobody reads.
- **The trace id rides with the logger** (ADR 0058), and it is the `x-trace-id` the 401 was
  answered with.

**What the client sees does not change.** `challengeError` in `handlers/mcp.ts` is the one
place a reason is reduced to RFC 6750's code: `insufficient_scope` is the 403 naming the scope,
and every other reason is the same 401 with the same challenge and the same body. A caller
holding a dead credential is still owed no account of how it died. `mcp.test.ts` pins that
a revoked token's response is byte-for-byte the response to no token at all.

**Findable.** `task obs:search FOR=status=<code>` asks Tempo for server spans answered with that
status (`span.http.response.status_code`), scoped to Undercroft's services like `errors`.
`FOR=status=401 SINCE=6h` lists the refused requests with their trace ids, and
`task obs:logs FOR=mcp_refused SINCE=6h` gives each one's reason. The `debug-trace` skill and
`docs/runbook/mcp-setup.md` say so.

### An OAuth access token lives eight hours

`ACCESS_TOKEN_SECONDS` is `8 * 60 * 60`.

Revocation does not depend on expiry. The consent row and the person are read on **every**
`/mcp` request (ADR 0061), so revoking the app on `/account` stops it at its next call,
whatever the token's `exp` says, and removing the person does the same. A short life bounds
only a copied token that nobody revokes. What fifteen minutes did do was break every client
that does not refresh mid-session. Eight hours is what Anthropic's own MCP authorization
server issues.

**The cost, stated:** a token copied out of a client works for up to eight hours, for as long as
its consent and its person stand. Before, the same copy worked for fifteen minutes. The refresh
token is unchanged, so a connector still renews past eight hours without sending its person
through consent.

## Options rejected

- **Logging where each reason is decided**, in `accessTokens.admit`, `verifyAccessToken`,
  `McpAuth.admit` and the two functions in `context.ts`. Five places would write the same event,
  each needing the request's logger injected, and none knows the status the client was
  answered with. Carrying the reason to the
  door means one line, written where the response is built.
- **Carrying the RFC 6750 code beside the reason.** The code is a function of the reason, and a
  value holding both can hold two that disagree.
- **Telling the client the reason**, in the challenge's description or the body. That would make
  the door an oracle for whether a guessed or stolen token ever existed. ADR 0060's uniform
  challenge stands.
- **Marking a 401 as an error span** so that `errors` finds it. A refused credential is the
  server working, and every OAuth client's first contact is one. `errors` would bury the 5xx it
  exists to show.
- **Keeping fifteen minutes and relying on clients to refresh.** Refreshing is the correct
  behaviour for a client, and Kanna will get it. But revocation already stops a token at its
  next call, so fifteen minutes narrowed only the window for a copy nobody revokes, and it
  kept breaking every client that holds one bearer for a session.

## Consequences

- A client failing at `/mcp` leaves a trace a person can find by status and a log line that
  says why. "It stopped working" becomes `expired`, `revoked` or `no_person`, which are three
  different conversations.
- A personal token whose person was deleted reads `unknown`, not `no_person`. Its row goes with
  them (`ON DELETE CASCADE`), so nothing is left that could prove whose it was.
- Each OAuth client's first contact writes one `info` line. It is expected, and cheap.
- The eight hours applies to tokens issued after the deploy. Tokens already issued keep the
  `exp` they were signed with.
