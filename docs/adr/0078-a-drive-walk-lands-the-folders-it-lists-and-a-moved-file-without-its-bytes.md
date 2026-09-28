# 78. A Drive walk lands the folders it lists, and a moved file lands again without its bytes

- Status: Accepted
- Date: 2026-09-28
- Supersedes, in part: [ADR 0033](0033-an-ingest-streams-and-does-not-re-read-what-it-holds.md)'s
  "Drive skips a file whose stored `source_updated_at` still equals the `modifiedTime` the
  listing carried". That test now decides whether the file's BYTES are fetched. Whether its
  RECORD lands is decided by whether the record changed.
- Extends: [ADR 0071](0071-a-record-a-complete-listing-no-longer-names-is-removed-at-source.md).
  A finished Drive walk is a complete listing, and it settles `raw.records` through the same
  `reconcileRemovals`.

## Context

Issue #305. A team records each client's status by where the client's folder sits in Drive: an
office folder holds one folder per status (Active, Dormant, Dissolved), each holds one folder per
client, and a client folder holds sub-folders of documents. The admin picks the office folder
with sub-folders included. When a client's status changes, someone drags its folder from Active
to Dormant. Only the folder says whose a file is, because files are often named after
counterparties. They were told to derive client and status in a dbt model, and a model cannot:

- **A file carries only the folder that directly contains it.** `driveListing.ts` lists every
  folder of the tree and uses each one only as the next place to look. No folder is landed, so
  nothing links `Finance` to `Client A` or `Client A` to `Active`.
- **A move changes nothing a model reads.** Dragging `Client A` changes no file inside it: each
  still sits in the same folder, so the payloads are identical before and after. A single file
  moved between folders does change its own `parents`, but `take` in `drive.ts` skips a file whose
  `modifiedTime` is unchanged, record and bytes together. Drive's reference does not say whether
  a move changes `modifiedTime`, so whether that move reaches the lake is not something this
  platform knows.
- **A removed file's record stays live.** `tombstoneMissing` marks `raw.documents` and nothing
  else. A model reading `raw.records` still places a file that left the pick where it was.

The issue asks for folder ids and never names: ADR 0015 keeps what a person wrote out of what
dbt reads, and an admin already matches an id to its folder in the source's folder browse. It
also asks that nothing above the picked folder becomes visible and that a moved folder does not
download the unchanged files beneath it again.

We looked at how other file connectors expose a tree before choosing. Fivetran, Airbyte's
file-based CDK and dlt key a file on its path of NAMES; none carries a parent id or a folder
record, and a move is a new file whose old path is never retracted. The APIs that do model trees
(Microsoft Graph's `parentReference`, Box's `parent`, Notion's `parent`) give each item its
immediate parent and nothing more, and Graph's delta documentation says why: a renamed or moved
folder does not return its descendants, so "always track items by id". A path stored on every
file goes stale the moment an ancestor moves. Each item pointing at its parent does not.

## Decision

**The collector describes the tree; a model resolves it.** The platform lands facts it read and
decides nothing about what a folder means. Client, status and the chain between them are the
model's, in SQL. A model resolves a chain with `WITH RECURSIVE`, which the model checker already
admits (`sqlChecks.ts` starts a query at `with`, and `recursive` is not a write word). Three
parts, and only the first is new code in the Drive collector.

**1. Every folder the walk lists lands as a record of entity `folders`.** Its payload is
`{ id, parents }`, canonicalised like a file's, with no name and no `modifiedTime`. The name
belongs to a person (ADR 0015). A folder's `modifiedTime` would move with its contents and land a
new version the model does not need.

- A picked folder lands with `parents: []`. Its real parent is outside the pick, and that id is
  never read into a record. A model knows a chain is complete when it reaches a folder with no
  parent.
- A folder the walk reached through a listing lands with `parents: [<the folder that listed it>]`.
  That is the fact the walk observed, and it is inside the pick by construction. Drive has given
  each item one parent since 2020, so this is Drive's own `parents` in practice. A legacy item
  with a second parent outside the pick does not leak that parent.
- A folder that is picked AND reached through another pick's listing lands with the listing's
  parent. Both folders are inside the admin's selection, so the longer chain reveals nothing
  outside it.
- A pick without sub-folders lands the picked folder alone. Folders the walk did not descend into
  are not landed, because nothing beneath them was read.

The walk already fetches these folders, so this costs no Drive request. A file's record is
unchanged, including its Drive `parents`.

**2. Whether a file's bytes are fetched and whether its record lands are two questions.**

- **Bytes:** a file whose stored `modifiedTime` matches and whose mark says its harvest finished
  (`knownRecords`, ADR 0033 and 0035) is not downloaded. Otherwise it is harvested whole, record
  and bytes, as today.
- **Record:** a file whose bytes are held lands its record again only when that record differs
  from the one held. The collector canonicalises the payload it would land, hashes it with the
  lake's own `sha256Hex`, and asks Postgres for the stored `content_sha256` of each live row
  (`storedDigests`, a new repo function that knows no source). Equal means skipped outright:
  nothing touches the lake or Postgres. Different means the record lands with no documents and
  leaves the mark as it stands, because no documents were settled this run (`marksIn` already
  leaves out a record that carries no count).

Folders only have the record question, and ask it the same way.

The check before landing is an optimisation, and the lake still decides. A wrong "different"
costs one put that the lake reports `unchanged`. A wrong "equal" cannot happen for a live row:
the digest is of the bytes `landRecords` stores, and the projection copies the lake's digest.
This is also why no code compares `parents`. Any change to what the record says, a move included,
changes the digest. And whether Drive moves `modifiedTime` on a move stops mattering for
correctness: if it does, the file is downloaded again and the lake dedupes the blob; if it does
not, only its record lands.

**3. A finished walk settles `files` and `folders` through `reconcileRemovals`.** A walk that
reached its end has named every file and folder the picks hold. `harvestDrive` returns those two
id sets, and `settleWalk.ts` hands each to the same `reconcileRemovals` that settles HubSpot
(ADR 0071). A held row that is no longer named is marked `deleted_at = now()`, and a removed row
that is named again is live again. Drive gets no removal code of its own, and a folder dragged
out of the pick is removed exactly like a file.

A stopped walk settles nothing. The summary is `null` there already (ADR 0051 and 0056), so
this needs no new guard. `tombstoneMissing` on `raw.documents` is unchanged, and it and the
`files` stream are decided from the same set, so the two tables cannot disagree.

**What a model reads for location is `raw.records`.** `raw.documents.metadata.parents` stays as
it is. It is where the file was when its bytes landed, and a document is not landed again when
only its location moves. The reference docs and the model-builder skill say so, and the skill
shows the recursive model that resolves a chain. The platform ships no macro for it: a hierarchy
is the reader's schema, not ours.

## Consequences

- The issue's test tree resolves. `statement.pdf`'s record names `Finance`; the folder records
  name `Client A`, `Active` and `Office`; `Office` names nothing.
- Dragging `Client A` into `Dormant` lands one new version, `Client A`'s. No file is downloaded
  and no file record lands, so the Journal's `read` count is 0. The model's next build places
  every file beneath it under `Dormant`.
- Moving a single file lands that file's record. It lands the bytes too only if Drive moved its
  `modifiedTime`.
- A file or folder that leaves the pick, by deletion, trashing or a drag outside, is marked
  removed in `raw.records` at the next finished run. One that comes back is live again.
- `folders` is a new stream: a new entity on the Raw lake page and a new row in `ops.run_entity`
  per Drive run, counted like any other. The `files` row does not count folders.
- The first finished run of each Drive source after this ships creates one record per folder,
  and marks removed every file record whose file has left the pick since it landed. That second
  part was always true of `raw.documents` and was never written to `raw.records`.
- Nothing changes for Gmail. Its summary gives no listing, for the reason ADR 0071 records.

## Cost

In a steady state each batch of 200 listed files costs two Postgres round trips instead of one
(`knownRecords`, then `storedDigests` for the files it holds), and each 200 folders cost one.
The lake is touched only for what changed. Nothing new is asked of Drive.

## Options rejected

- **The collector computes each file's chain and lands it on the file.** One field for the model
  to read, and it goes stale whenever an ancestor moves. Dragging a client folder would re-land
  the record of every file beneath it. The collector would also be maintaining the source's
  hierarchy on the model's behalf, which is the Drive-specific business this ADR keeps out of the
  platform. Graph's delta documentation gives the same reason for not relying on paths.
- **Drive's Changes API (`changes.list` with a `startPageToken`).** A cursor machinery of Drive's
  own, beside the spec runtime's. Google does not document whether moving a folder reports its
  descendants. And folder records would still be needed for a model to resolve a chain. It could
  later make walking a large Drive cheaper; it does not decide what is correct.
- **Land every listed record on every run and let the lake decide.** No new query, and one
  `newestSha` lookup in the object store per file per run, even when nothing changed. That is
  ten thousand object-store requests to confirm an unchanged Drive of ten thousand files.
  Asking Postgres for the digests is one statement per batch.
- **Compare `parents` in `drive.ts` to detect a move.** It encodes one Drive field as the only
  thing about a file that can change without `modifiedTime`, and it misses the next one. The
  digest compares everything the record says.
- **A tombstone sweep of Drive's own for folders.** A second `tombstoneMissing` would be a copy
  of `reconcileRemovals` with one table changed. ADR 0071 made that function entity-agnostic so
  the next source would not need one.
- **Land folder names, or paths of names, for the model.** ADR 0015. The issue set this aside
  itself.
- **Ship a dbt macro that resolves ancestry.** A macro would be platform code shaped by one
  reader's hierarchy. A worked example in the model-builder skill teaches the same query without
  the platform owning it.
