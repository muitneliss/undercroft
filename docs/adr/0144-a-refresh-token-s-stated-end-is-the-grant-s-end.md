# 144. A refresh token's stated end is the grant's end

- Status: Accepted
- Date: 2026-10-18
- Builds on: [ADR 0030](0030-an-email-is-a-leaf-of-the-book-posted.md), whose grant-lapsing
  notice this arms for Google as well as Xero.

## Context

In one customer every Google connection, Gmail and Drive on two accounts, was refused at
refresh about seven days after each reconsent, again and again. Each refusal set the card to
"Cần cấp lại quyền" (needs reconnecting) with no warning before it. Google answers `invalid_grant` for a refresh
token that has expired, and the worker reads that correctly as a dead grant (issue 213). What
was missing was any notice ahead of it.

Seven days is Google's rule for an OAuth project whose consent screen is still in **Testing**.
Its refresh tokens die a week after issue, whatever the platform does. Google says so in the
token response, as `refresh_token_expires_in`. It sends the same field for a person who grants
time-based access. Nothing here read it. `grantExpiry.ts` said "Google announces no end", so
`app.connection_secret.grant_expires_at` stayed `NULL` for every Google grant and the
week-ahead warning never fired.

## Decision

- **The control plane reads `refresh_token_expires_in` at consent** and sends it to the worker
  as the credential's `refreshExpiresAt`, an instant. An absent field is `null`: "Google said
  nothing", never "it never dies".
- **A stated end is the grant's end, and outranks our own rule.** `grantExpiryFor` answers the
  stated instant when there is one, Xero's sixty days when there is not, and `null` otherwise.
  A reconsent that states nothing writes `null`. That covers a project published since the last
  consent: a date kept from the old token would warn about an end that will not come.
- **A refresh that hands back the same refresh token keeps the end already stored**
  (`grantExpiryAfterRefresh` answers `"unchanged"`, and `writeCredential` keeps the column and
  its `warned_at`). Google does not rotate, so its hourly refresh says nothing new about when
  the token dies. Writing the rule's `null` there would wipe the date within the hour. Xero
  rotates, and its rule moves the date sixty days out as before.

A Testing project's grant is therefore warned about straight after consent, because seven days
is inside the warning's week. That warning is true and the remedy is the operator's: publish the
consent screen. `docs/runbook/google-ingestion-setup.md` says how.

## Options rejected

- **Assume seven days for every Google grant.** That is a guess about a console setting. Rule 2
  forbids it, and it would warn about a published project's tokens, which do not expire.
- **Read the field on every refresh as well.** Google states it once, beside a token it then
  never rotates. Carrying it through both refreshers and their shared exchange would add a
  second path to a fact the consent already recorded.
- **Probe the project's publishing status.** No API a deployment's client can call answers it.
  The token response is where Google tells us.
