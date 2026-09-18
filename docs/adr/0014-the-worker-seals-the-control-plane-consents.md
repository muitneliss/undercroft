# 14. The worker seals; the control plane consents

- Status: Accepted
- Date: 2026-09-18

## Decision

A per-tenant Google consent is run by the **control plane** and sealed by the **worker**.

The control plane serves `GET /oauth/google/callback`, exchanges the authorization code, and
POSTs the resulting token bundle to a new worker verb on the trigger-token allowlist. The
worker holds `UNDERCROFT_SECRET_KEY` and writes `app.connection_secret`. The control plane
never has the key and so can never read a stored credential back.

Ingestion uses a **second Google OAuth client**, separate from the sign-in one:
`UNDERCROFT_GOOGLE_INGEST_CLIENT_ID/_SECRET`.

Drive asks for **`drive.file`**, not `drive.readonly`.

## The constraint that forces the split

Google's redirect must land on a public origin. The control plane has a domain; the worker
deliberately does not. Sealing must happen where the master key is. The worker has the key;
the control plane deliberately does not, and `services/connections.ts` has said so since it
was written.

Both halves are true at once, so the flow crosses one hop.

## Options rejected

**Give the control plane `UNDERCROFT_SECRET_KEY`.** One fewer hop and no new verb. Rejected:
it puts the master key in the internet-facing process, and it breaks the invariant ADR 0005
is built on. The control plane would gain the ability to decrypt every stored credential for
every tenant, permanently, to save one internal POST.

**Expose the worker publicly, or proxy the callback to it.** Puts an internet-reachable route
on the process that holds the key. Strictly worse than the above in the way that matters.

**One Google client for both sign-in and ingestion.** Fewer secrets to manage. Rejected
because the failure it permits is silent and total: one wrong scope list on the login path
and signing in hands over a mailbox. Two clients make that impossible rather than unlikely.

**`drive.readonly` with our own `q=` filter.** Simpler UI — a server-side folder listing
instead of Google's Picker. Rejected on two counts. It is a Google _restricted_ scope, so it
would pull the product into an annual CASA security assessment alongside Gmail; and the
shipped promise "No other folder is read" would be enforced only by our own query, where
under `drive.file` Google enforces it for us. A promise the platform cannot break is worth a
Picker integration.

## Accepted residual risk

**The plaintext token bundle crosses the internal Docker network in a POST body.** It is
stated here rather than discovered later.

The trust assumption is the one that already exists: the trigger token crosses the same
network, and a reader of that traffic can already start any verb on the allowlist. What the
split still buys is that a compromise of the _internet-facing_ process yields no stored
credential for any tenant, because it holds nothing that can open one. The alternative —
giving that process the key — loses exactly that and gains nothing.

## Consequences

- **`app.oauth_handshake` holds the in-flight state, not a cookie.** There is no cookie
  middleware in the control plane; Better Auth owns every cookie in the process. A row gives
  three things a cookie cannot: a TTL the server enforces rather than trusts, single-use
  consumption as one `DELETE ... RETURNING` rather than a read-then-write a replay can race,
  and a record of which admin began the flow, which the audit entry needs. The state is
  stored as a digest, as `app.invitation.token_sha256` is. The PKCE verifier is not hashed —
  it goes back to Google verbatim — which is the second reason the table is in `app`.
- **Order in the callback is the security argument.** State first (consuming it makes a
  replay impossible), then the admin check (re-asked at the moment of use, because minutes
  pass and a role can be withdrawn in them), and only then is the code spent.
- **Unknown, expired and already-used states are refused identically**, so the callback is
  not an oracle for whether a guessed state ever existed.
- **Three grants `040_grants.sql` never made are now load-bearing** and are in
  `070_google_ingestion.sql`: the worker can INSERT and UPDATE `ops.connection` and INSERT
  `app.connection_secret`. None had ever fired, because `accessToken` had no caller passing a
  refresher.
- **Gmail still needs CASA.** No non-restricted Gmail scope reaches attachments. The whole
  surface is gated on `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID`: unset, `startOAuth` returns the
  placeholder it always has and every Google source reads "not connected" — no dead buttons
  while verification is pending.
