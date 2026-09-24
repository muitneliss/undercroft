# 47. Drive reads with `drive.readonly`

- Status: Accepted
- Date: 2026-09-24
- Supersedes: the "Drive asks for `drive.file`, not `drive.readonly`" decision of
  [ADR 0016](0016-the-worker-seals-the-control-plane-consents.md), and the option it rejected
  as "`drive.readonly` with our own `q=` filter". Also supersedes the "Move to
  `drive.readonly`" rejection in [ADR 0031](0031-a-picked-folder-may-be-read-to-the-bottom.md),
  and answers the question 0031 left open under "The open question, and how it fails". The
  rest of both ADRs stands: the worker seals, the control plane consents, two Google clients,
  and `recurse` as the admin's recorded choice.

## Context

Issue #178. A Drive connection was scoped to one folder, with `recurse: true` and nine file
types. Its run closed `status=ok` after 0.67 seconds with `landed: 0` and one refusal,
`no-matching-files-in-folder`, against a folder that held files one to five levels down. The
same account's Gmail connection landed 8,401 messages.

The grant was `drive.file`, the scope ADR 0016 chose. Under `drive.file`, picking a folder in
Google's Picker does **not** grant the files already inside it. Google's documentation says
nothing either way. Uppy found the same thing in transloadit/uppy#6385: "under drive.file,
empty folder and no access to the folder's contents are indistinguishable". Google does not
refuse the listing. `'<folder>' in parents` answers 200 with an empty page, the collector
records that the folder matched nothing, and the run is green.

This is not the question ADR 0031 left open, which asked whether access cascades to a
_nested_ folder. A picked folder's _direct_ children are not readable either, unless the app
created them or the Picker picked them one by one. The failure 0031 planned for, a refusal
that raises, never came, because Google sends no refusal. 0031 said the answer would be "a
scope decision recorded as a new ADR". This is that ADR.

The reporter suspected a second cause: that `recurse` descends only one level. It does not.
`listMatchingIn` queues every sub-folder it finds, and one loop walks the queue to its end. The
suite now lands a file five levels down.

## Decision

**Drive's ingestion consent asks for `https://www.googleapis.com/auth/drive.readonly`.** The
scope each Google source reads with lives in one table, `GOOGLE_READ_SCOPES` in
`@undercroft/contracts`. The consent asks from that table (`oauthProviders.ts`), and the worker
checks against the same table, so the two cannot disagree.

**A grant recorded without its source's read scope is refused before Google is asked.**
`requireReadGrant` (`apps/worker/src/services/google/grant.ts`) reads `ops.connection.scope`
and raises `GrantTooNarrow`, whose message names the missing scope and says to reconnect the
source. Two callers use it:

- **the collector**, before it harvests. A run fails with that reason instead of closing green
  on `no-matching-files-in-folder`;
- **the browse**, before it lists. It answers `scope-insufficient`, which the control plane
  words as a reconnect.

An empty recorded scope is not refused. It means nothing was recorded, and the card's
`presentStatus` reads it the same way. The card itself needs no change: a `drive.file` grant no
longer covers what Drive asks for, so `grantCovers` already shows every such connection as
`needs_reconnect`.

**Drive can now be browsed.** `connections.browseScope` for Drive lists every folder the grant
can see, each with its path, including shared drives. It also lists the distinct file types
present, so an admin can widen `fileTypes` past the preset. Both lists are bounded by a page
count (`DRIVE_BROWSE_BOUNDS`). A list that stops at its bound, or that Google reports as
`incompleteSearch`, is named in the answer's `partial`. It is never presented as the whole
list (issue #177).

**The browser Picker stays, and its own token stays `drive.file`.** The Picker is how an admin
at the web UI chooses. Its token shows the dialog and returns ids. It is never sent to the
server, and `drive.file` is the narrowest scope the Picker works with. Widening a browser token
to read the whole Drive would add exposure and buy nothing.

## Why

- **`drive.file` cannot deliver the feature.** A folder pick is the main way Drive is scoped,
  and under `drive.file` it can never be read. "The folder is empty" and "the grant is blind to
  it" return the same empty page. No filter we write can tell them apart.
- **The CASA argument no longer holds.** ADR 0016 rejected `drive.readonly` partly because it
  is a Google _restricted_ scope, which requires an annual CASA security assessment. That
  assessment applies to the OAuth client, not to one scope. The same ingestion client
  (`UNDERCROFT_GOOGLE_INGEST_CLIENT_ID`) already asks for the restricted `gmail.readonly`, so
  it must pass CASA either way. `drive.readonly` adds a scope to an assessment this client
  already needs. It does not add a new assessment.

## The cost accepted

**"No other folder is read" is now our promise to keep, not Google's.** Under `drive.file`, a
wrong query failed closed. Under `drive.readonly` the credential can read the account's whole
Drive, and three things keep a run within what the admin chose:

- the collector's `'<picked id>' in parents` query;
- the recorded `recurse` choice;
- reading a directly picked file by its own id.

The query is built in one place (`driveListing.ts`), and the suite pins its exact shape. The
consent copy is unchanged because the promise is unchanged. What enforces it has moved.

**Every existing Drive connection must reconnect.** Until it does, its card reads
`needs_reconnect` and every run fails with the reconnect reason. That is loud on purpose. The
alternative is the green empty run that caused issue #178.

## Rejected

- **Keep `drive.file`.** It cannot read a picked folder's contents, which is the feature.
- **`drive.metadata.readonly`.** It is also restricted, so it has the same CASA cost as
  `drive.readonly`. It also cannot download file content, and landing the bytes is what the
  collector exists to do.
- **Picker multi-file selection under `drive.file`.** Picking each file makes those files
  readable, but a file added to the folder later is never readable. A scope that must be picked
  again for every new statement is not a sync.
- **Detect a `drive.file` grant by an empty listing.** An empty folder and a blind grant return
  the same page, so this would be a guess. The recorded scope is evidence. An empty page is not.

## Consequences

- `BrowseScopeRequest.kind` gains `folders`. A browse item's `kind` gains `folder` and
  `file-type`. A folder item is `{ id, name, kind: "folder", path }`, so `{ id, name, kind }`
  pastes into a Drive scope's `files` unchanged. `BrowseScopeResponse.partial` defaults to
  empty. The control plane now parses the worker's answer instead of casting it, so that
  default applies when an older worker answers.
- A refused browse carries `details` naming the source, the listing, the reason and the
  remedy. The control plane's `refusal` helper (`handlers/trpc.ts`) puts them on the tRPC
  error's `data.details`, and the CLI passes them through as `error.details`.
- `error.scopeInsufficient` names the source instead of Gmail, because Drive and Xero browse
  too.
- `docs/runbook/google-ingestion-setup.md` lists `drive.readonly` as restricted, and tells an
  operator that existing Drive connections must reconnect.
