# 96. The CLI signs in to a local install the way the browser does

- Status: Accepted
- Date: 2026-09-30
- Supersedes: the last consequence of
  [ADR 0094](0094-a-local-install-signs-its-owner-in-on-loopback.md), "The CLI still signs in by
  emailed code only; a desktop owner uses it with a personal access token minted on `/account`".
  The rest of ADR 0094 stands.
- Related: [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md) (the CLI is a caller, over
  HTTP, with a person's own session), [ADR 0095](0095-undercroft-installs-through-a-setup-wizard-that-drives-docker.md)
  (the installer that writes a desktop install).

## Context

A desktop install signs its owner in on loopback with no password and no click (ADR 0094). Its
page asks `config.signIn` which ways in the server offers, and when the answer is the local
method alone it posts to `POST /api/auth/sign-in/dev` and has an ordinary Better Auth session.

The CLI knew only the emailed code. A desktop install has no mail key, so `undercroft auth login`
asked for an address and then for a code that could never arrive. ADR 0094 said the owner would
use a personal access token instead. That was not true of the CLI: it keeps a session cookie per
origin and has no way to send a bearer token. A personal token is how an MCP client connects
(ADR 0060), not the CLI.

## Decision

1. **The CLI signs in with the same local method the page uses.** It posts to
   `/api/auth/sign-in/dev` over `node:http`, as it already posts the two email-code requests, and
   keeps the session cookie the server set under its origin in `credentials.json`, exactly as it
   keeps one from an emailed code. The address comes from the server's answer. The request carries
   no address, because the server decides who the method signs in as.
2. **It is chosen the way the page chooses it, from what the server offers.** `auth login` with
   neither `--email` nor `--code` asks `config.signIn` first. When the answer is the local method
   alone, it signs in on this machine without asking anything. The home page (`undercroft` at a
   terminal) does the same and goes straight to the contents. When the server offers another
   method beside it, the emailed code is asked for as before, and `auth login --local` is the
   CLI's equivalent of the page's button. When the server gives no answer, for example an older
   server, the CLI assumes nothing and asks for the emailed code.
3. **`--local` is refused before any request when the URL is not loopback.** The server refuses
   too, because it never builds the method behind another origin. But its answer is a 404, which
   cannot say whether the method is switched off or the server is on another machine. The CLI's
   check says which, in the person's language, and sends nothing. The set of loopback names
   moved to `@undercroft/core/loopback`, so the CLI's check and the server's cannot disagree.
4. **The request goes to the configured origin exactly, and the server's refusal is passed on.**
   The server refuses a request whose `Host` is not its public URL's host (ADR 0094). A profile
   that says `127.0.0.1` for an install at `localhost` is therefore refused with
   `PERMISSION_DENIED` and the server's own sentence naming the address to use. That sentence no
   longer says to open a page, so it reads correctly from the CLI too.
5. **Signing in grants no writes.** `allowWrites` stays a per-profile setting that only a person
   at a terminal can turn on (ADR 0044). Signing in says who the person is. Letting an agent
   change things through a profile is a separate decision, and a sign-in that needs no proof is
   the last place to make it implicitly.
6. **The installer's closing lines name the two commands.** A desktop install ends by printing
   `undercroft config set-profile local --url <its url>` and `undercroft auth login`, at the exact
   origin the sign-in accepts.

## Consequences

- On a desktop install, `undercroft config set-profile local --url http://localhost:13000` and
  `undercroft auth login` sign the owner in. The same works for an agent in agent mode, with no
  second step.
- Anything on the machine that can run the CLI can sign in as the owner. That is the trust ADR 0094
  already places in the machine, since the same program could post to the endpoint itself. Writes
  still need the profile's `allowWrites`.
- `auth login` makes one more request, `config.signIn`, when it is given no address.
- The CLI still has no bearer-token path, and gains none here.

## Options rejected

- **A service token, or a CLI-only endpoint that skips Better Auth on loopback.** Either would be
  a second credential with no session behind it, the backdoor ADR 0044 refuses and
  `cli-no-backdoor` guards against. Every role gate, sign-out and `resolveCaller` would have to
  learn about it. The local method already yields an ordinary session.
- **Reading the installer's `.env` to learn the owner's address, or to mint a session.** The CLI
  would then read a file that holds the platform's secrets, and would depend on where one
  installer puts it. A CLI that reads `UNDERCROFT_SECRET_KEY` can forge any session. The server
  already knows the address and never tells it; the CLI does not need it to sign in.
- **A personal access token from `/account`, as ADR 0094 said.** The CLI has no bearer path, and
  adding one is a second way to authenticate that `allowWrites`, sign-out and the per-origin
  store would all have to account for. It would also make the owner of a one-click install open
  a browser, find a page and paste a secret before the CLI works. That is the friction the local
  method exists to remove.
- **A profile field saying the profile signs in locally.** It would be a second switch beside the
  server's own list, able to disagree with it. ADR 0094 rejected deciding this anywhere but the
  server for the same reason. The profile stays `{ url, allowWrites }`.
- **Always trying the local method first, then the email code.** On a server that offers both,
  the CLI would choose the method that proves nothing for a person who configured one that does.
  The page does not do that either.
