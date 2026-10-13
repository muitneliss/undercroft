# 134. The CLI signs in with a personal token when nobody is at its terminal

- Status: Accepted
- Date: 2026-10-13
- Supersedes, in part: [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md)'s "`/trpc` stays
  cookie-only", and, for a run with nobody at the terminal,
  [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md)'s "the CLI signs in with the same
  Better Auth email one-time code the SPA uses and keeps the session cookie". The rest of both
  stands, their rejection of a service token included.
- Relates to: [ADR 0061](0061-an-mcp-client-signs-its-person-in-and-draws-two-widgets.md), whose
  OAuth access tokens this does not admit at `/trpc`;
  [ADR 0113](0113-every-action-is-in-the-audit-log-and-people-can-read-it.md), whose `cli` channel now covers a token too.

## Context

Issue 467. A CI job, a scheduled script or an agent running with nobody at its terminal cannot
sign the CLI in: the emailed code arrives in a person's inbox, and a session cookie copied off a
laptop into a CI secret is a browser session outliving the browser, with no grant and no expiry
a person chose. The platform already has the credential for exactly this case. A personal
access token (ADR 0060) is a person's own, reaches what they reach, holds a `read` or `write`
grant they chose, expires within a year and stops working at the next call once revoked on
`/account`. But `/mcp` was the only door that read one; `/trpc`, which the CLI speaks, read the
cookie and nothing else.

## Decision

### `/trpc` admits a personal access token, through the door that already reads one

`apiContext` in `handlers/context.ts` chooses the door by the request, by the rule an export's
download already used ([ADR 0111](0111-an-export-is-a-link-to-a-streamed-csv.md)): a request carrying `Authorization` is admitted by
`bearerContext` and ONLY by it; one without is the cookie door's. A cookie sent beside a bearer
that failed does not rescue it. There is no new auth surface: the same `resolveBearer`, the
same per-call read of the token's row (so revocation and expiry bind at the next call), the same
shared tail that resolves the person, and the same refusal row in the audit log. A bearer
refused at `/trpc` is nobody, and the router answers nobody `UNAUTHORIZED`, as it answers any
anonymous call; nobody's grant is `write` at both doors so that a refused bearer is told it is
not signed in rather than that it may not write.

What the token may do is decided where it always was. The grant guard on the base procedure
(`trpc.ts`) refuses a `read` token anything that is not a read, with `WRITES_DISABLED` and the
grant in the refusal's facts. `sessionProcedure` keeps `account.*` from any token, so a token
still cannot mint a wider one.

**Only a personal token.** An OAuth access token (ADR 0061) is issued for `/mcp` -- its audience
is that resource, and `mcpAccessToken.ts` checks it -- so `/trpc` refuses one as `unknown`
before verifying it (`Bearers` in `context.ts`). Honouring a token at a resource it was not
issued for is what audience-binding exists to stop. A personal token names no resource; it is
the person's own credential for any door that reads a bearer.

**The audit channel** is `cli` for a caller that says it is the CLI, whatever it presented
(`channel.ts`); any other bearer is `mcp`. As before it is for reading, never for authority. The
row keeps the token's id in `credential`, so a person can tell their CI job's actions from
their own at a terminal.

### The CLI keeps the variable's name, never the token

`undercroft auth login --token-env <VARIABLE>` reads the token from that environment variable,
proves it by calling `session.me` with it, and stores `{ email, tokenEnv }` under the origin in
`credentials.json` -- the name of the variable, and whose token it was. Every later request
reads the variable again (`credentials.presented`) and sends `Authorization: Bearer`, and no
cookie with it. So the token is in no argument list, no file the CLI writes and no envelope; it
stays where its owner put it, and rotating it is changing the variable.

What the CLI says is its own, because only it knows how it signed in:

- the variable unset at a call is `AUTHENTICATION_REQUIRED` naming the variable, refused before
  any request;
- a token the server refuses is `AUTHENTICATION_REQUIRED` saying to mint a new one, never "run
  `auth login`", which with the same variable would change nothing;
- a token's grant refusing a command keeps the server's code, `PERMISSION_DENIED`, and its facts,
  and adds `needs: "write"` beside the `grant` it holds.

`allowWrites` is unchanged and still decided first, on the client (`safety.ts`): a `write` token
writes only through a profile a person allowed writes on. A token's grant and a profile's
permission are two people's decisions, or one person's made twice, and each binds on its own.
`auth logout` forgets the variable and does not revoke the token -- there is no session to end,
and its note says so.

## Why this is not the service token ADR 0044 and ADR 0060 rejected

A service token is a credential with no person behind it. This is a person's own token: the
platform resolves its owner on every call, it reaches exactly the tenants and roles they hold,
it dies with their account, and its grant and expiry are what they chose when minting it. A job
signed in with one acts as that person, and is recorded as that person, through that token.

## Options rejected

- **The token as a flag's value (`--token upat_…`).** Argv is readable by every process on the
  machine and kept in shell history and CI logs. `--token-env` takes a name, and a value that is
  not a name -- a token pasted where the name belongs always holds a `.` -- is refused without
  being repeated back.
- **Storing the token in `credentials.json`.** It would put a year-long credential in a file
  that outlives the job, beside every session the person holds, and make rotation a second
  place to update. The variable is already where the secret is kept; the CLI only needs its
  name.
- **A new kind of token for the CLI.** It would be a second credential model -- table, grant,
  revocation, audit -- for a person's own token that already has all four.
- **Reading a bearer at `/trpc` beside the cookie, either admitting.** A cookie would then rescue
  a revoked token, which is exactly what must stop at the next call.
- **Admitting an OAuth access token at `/trpc` too.** Its audience is `/mcp`; see above.
