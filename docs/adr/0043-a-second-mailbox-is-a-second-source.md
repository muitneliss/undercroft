# 43. A second mailbox is a second source

- Status: Accepted
- Date: 2026-09-23
- Answers: the "separate argument" [ADR 0040](0040-the-catalogue-does-not-inherit-the-lakes-deduplication.md)
  deferred about widening `source` in the key. This ADR takes the other side of it: `source` is
  not widened, it is refined. Extraction's deduplication stays per source, as 0040 left it.

## Context

A connection was keyed `(tenant_id, source)`, and so was everything around it:

- `ops.connection`, `app.connection_secret`, `app.connection_detail`, `app.oauth_handshake`;
- the one-running guard on `ops.run`, the cadence and the due list;
- `raw.records`, `raw.documents` and both cursors;
- the lake keys (`records/<source>/<tenant>/…`).

A tenant with two mailboxes could hold one. Consenting the second **replaced** the first: its
credential, its address, its chosen labels and its account id. The disconnect/reconnect cycle
this forced also threw away its incremental state. Issue #125 describes a real corpus where
neither mailbox is a subset of the other. One receives most inbound mail, and the other is the
outbound identity, holding sent mail and threads that exist nowhere else.

There was a worse, quieter defect under it. **Nothing checked that a reconnect was the same
account.** "Reconnect" on mailbox A, completed by a browser signed in as B, sealed B's token
under A's source. Every run after it filed B's mail under A's stream, green, with nothing
erroring.

And one Gmail fact makes naive support wrong: **`message.id` and `threadId` are per-mailbox.**
The same letter in two mailboxes carries two unrelated ids. On the issue's corpus, 18% of
harvested rows were a second copy of a letter already counted, and 30 of them were queued for a
person to rule on twice. The id that survives mailboxes is the RFC 5322 `Message-ID` header,
which we already store in each message's payload.

## Decision

### The account is part of the source

The first account of a kind keeps the bare source, `gmail`. Every further account is a source
of its own, `<kind>.<account key>`, for example `gmail.3fa9c1d2e0ab`:

- The account key is the first 12 hex characters of `sha256(sub)`. `sub` is Google's opaque
  account id, already recorded in `ops.connection.external_account_id` (BI-readable, and never
  an address).
- This is `accountSourceFor` in `apps/control-plane/src/services/accountResolution.ts`, on top
  of `accountSourceOf` in `@undercroft/contracts/sources`.
- Only `gmail` and `drive` may carry a key: `MULTI_ACCOUNT_KINDS`.

Everything that must be per-account was already per-source, so it now is per-account by
construction, with no new code:

- the sealed credential, and the `FOR UPDATE` row lock its refresh takes. Two mailboxes'
  refreshes never contend, and a re-consent of one cannot take down another (issue items 5, 6);
- `run_one_running`, the last run, and the status on the card;
- the cadence, and the due list Kestra walks (the body it posts carries the source verbatim);
- the rows in `raw.records` / `raw.documents` and their lake keys. Two mailboxes cannot collide
  on a message id, and every row says which account it came from (item 3);
- the "already held" skip set of ADR 0033/0035, so re-harvesting one mailbox never touches
  another's rows.

The key is **derived, not allocated**. The same account always maps to the same source, so
"add an account we already hold" is a reconnect rather than a duplicate, and there is no slot
counter for two consents to race over.

### A kind is read in one place

`@undercroft/contracts/sources` holds `parseSourceInstance` and `sourceKind`. It is its own
entry point because the browser needs it and the root barrel reaches `node:fs`. Everything that
asked "is this Gmail?" of the literal source now asks it of the kind:

- the Google path in the worker;
- the refresher lookup;
- the label listing and the revoke;
- `providerOf` and the requested scopes;
- the alert's vendor name;
- the UI's labels.

The lookups with the most callers moved down into `connectionScope.ts`: `parseScope`,
`needsScope`, and `isScopedSource`, which replaced the exported `SCOPED_SOURCES` set. A caller
handed a set of kind names asks it `.has(source)`, which answered `false` for every second
mailbox. The worker's scope guard did exactly that.

`startIngest` refuses a string that is not a source instance before anything reads it: a suffix
on a kind that cannot hold one, or anything off the connector-id grammar. The spec path reads
`${source}.yaml`, and a source is a string a caller chose.

### An account id, once recorded, is only ever replaced by itself

This is the guard, and it is in SQL (`layering.md`: a guard belongs in SQL when concurrency
matters). `upsertConnection`'s `ON CONFLICT … DO UPDATE` carries a `WHERE`: the incoming id is
empty, the stored one is empty, or they are equal. `RETURNING` says whether it wrote.

- On `false`, the worker's `storeCredential` seals nothing and answers **412**
  (`account_mismatch`).
- Two consents racing for one source cannot both pass: the conflict row is locked, and the
  second finds the first's account.

An empty incoming id pins nothing and **erases nothing**: `COALESCE(NULLIF(…))`. That fixes a
latent Xero defect. A Xero consent names no organisation, because the organisation is chosen
afterwards, and reconnecting used to blank the chosen organisation's id. The next run then
refused for want of the header it supplies, until somebody saved the scope again.

### A consent is resolved by who granted it

`app.oauth_handshake.adds_account` records which button started the flow (migration
`260_connection_accounts.sql`). It is needed because "Reconnect" on the first mailbox and "Add
another account" both start from the bare `gmail`, and only the click knows which was meant.

At the callback, `resolveAccount` decides the source from the handshake, Google's `sub`, and
this tenant's connections of the kind. It is pure and has no transport.

A (re)connect is pinned. It is refused as `account-mismatch` when:

- the target has a different recorded account;
- the account is already connected under another source, because two sources for one mailbox
  is the double count;
- the target is a derived source whose key is not this account's.

An add resolves by identity:

- an account already held is reconnected where it is;
- otherwise, a kind with no first account gives the bare source;
- otherwise the account gets a derived source of its own.

It asks Google for `prompt=consent select_account`. With one session in the browser, Google
otherwise skips its chooser and consents the account already signed in, which is the mailbox
the tenant already has. A reconnect sends `login_hint=<address>`.

No identity is not a match. A consent with no `sub`, or an add while the first account never
recorded one, is refused as `account-unidentified` rather than resolved by the likelier reading.
Rule 2.

An add that loses the race is resolved once more. Two admins adding two different mailboxes at
the same moment both read "no first account yet", and both resolve to `gmail`. The pin admits
one of them. The other's second read sees the winner and resolves to a source of its own. A
reconnect is not retried: its refusal is the answer.

### Deduplication is a projection: `gmail_letters()`

`raw.records` stays one row per copy. Both copies really did arrive, and the raw layer must not
be made to lie about what a mailbox held. The fold is a macro every rendered dbt project
carries, beside `parse_amount` (`packages/db/src/services/dbtProject.ts`,
`gmailLettersSql`). It gives one row per letter:

- `copies`, and `sources` / `message_ids` / `thread_ids` in a fixed order, so which mailboxes
  held it, and under what local ids, stays answerable;
- `message_time`;
- `documents_landed`;
- `headers_conflict`.

It becomes a table only when a tenant writes a model that uses it. That is how the platform
still ships no business schema. The issue's two rules, as it wrote them:

1. **A letter with no anchor stands alone.** An empty `Message-ID` is a missing key, not a
   shared one. `letter_key` falls back to `source:source_record_id`, so anchorless letters can
   never fuse into one fictional mega-message.
2. **Evidence found in one copy belongs to the letter; the strongest outcome across copies
   wins.** Here that is `documents_landed = max(…)`. The issue's "record the disagreement rather
   than smoothing it away" is `headers_conflict`: a column, not a comment asserting it cannot
   happen.

The header lookup is case-insensitive, because rows written before #65 normalised the header
store `Message-Id`.

## Consequences

- **A model that filters `source = 'gmail'` sees only the first mailbox.** It filters
  `source = 'gmail' OR source LIKE 'gmail.%'`, or selects from `gmail_letters()`. The rendered
  `sources.yml` says so, and so does the runbook.
- **The card lists every account of a kind, each with its own mark.** A disconnected account
  stays listed: it can be reconnected, and its history is its own. Actions on the card (Run
  now, Change scope, Cadence, Disconnect) act on the account it shows.
- **A failed-run email names the mailbox.** The address is read from `app.connection_detail`,
  where it always lived.
- Two mailboxes due at the same tick harvest at the same time in one worker. Each streams, so
  memory rises by one harvest's chunk rather than by a mailbox.

## Out of scope, deliberately

- **No per-run identity probe.** The issue pins each mailbox by calling the profile endpoint
  before every harvest, because its failure was a config file pointing at another mailbox's
  token file. Here a credential is sealed into the row it was consented for, and the consent is
  where the swap could happen. That is where the pin is.
- **The same attachment in two mailboxes is extracted twice.** Extraction deduplicates per
  `(tenant, source, sha256)` (ADR 0040), and widening that is 0040's argument, not this one.
- **An ingest key cannot be scoped to one account.** `allowed_sources` names kinds; the lake
  write API is not how Google sources arrive.
- **The assistant names an account by its source id** (`gmail.3fa9c1d2e0ab`), which is also
  what a privileged revoke asks the reader to retype. It is unambiguous, which is the property
  that confirmation exists for; wording it by address is a later nicety.

## Options rejected

- **An `account` column on every table.** It is the normalised answer, and it would re-key
  `ops.connection`, the secret, the detail, the handshake, the run's guard, both cursors, the
  partitioned `raw.records` (a rewrite under `ACCESS EXCLUSIVE`), `raw.documents` and the lake
  key grammar. All of it is to make per-account what per-source already is. Every repo signature
  would grow an argument that means the same thing `source` already means.
- **An allocated slot (`gmail.2`, `gmail.3`).** It reads better in SQL, but it needs a counter
  that two consents race over, and it cannot tell "add the account we already hold" from "add a
  new one" without the lookup the derived key makes unnecessary.
- **The suffix as the raw `sub`.** It is deterministic too, but 21 digits long in every lake
  key, and it is no more opaque than a digest of it.
- **Dedupe inside the collector, landing only the first copy.** This makes the raw layer lie
  about what the second mailbox held, and it decides "first" by which mailbox happened to run
  first.
