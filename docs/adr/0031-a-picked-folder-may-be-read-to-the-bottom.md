# 31. A picked Drive folder may be read to the bottom, if the admin says so

- Status: Accepted
- Date: 2026-09-21

## Decision

A Drive selection carries `recurse`. False lists a picked folder's children and stops, which
is what descent has always done; true walks the whole tree beneath it. The admin chooses, in
the scope picker, and the card reads the choice back.

**The default is false, and that is the load-bearing half.** `DriveScope.recurse` is
`z.boolean().default(false)` (`packages/contracts/src/connectionScope.ts`), so every selection
recorded before this field existed — none of which carries the key — parses to `false` and
keeps landing exactly what it landed yesterday. The same idiom as `fileTypes`, which defaulted
to PDF-only for the same reason when it arrived.

Three other things fall out of the walk and are part of the decision:

- **A folder is a container, never a document.** `driveListing.ts` partitions each page by
  Drive's folder MIME type: folders are places to look next, or nothing. This closes a defect
  that predates recursion — with `fileTypes` empty ("every type") a sub-folder came back in
  the listing and was landed as a zero-byte document whose whole content was its name.
- **The walk is finite by construction.** A `visited` set of folder ids, so a shortcut or a
  folder reachable down two branches is listed once rather than forever.
- **The refusal stays at the pick.** A picked folder whose whole tree matched nothing records
  one `NOTHING_MATCHED`, not one per branch. An admin picked one thing and is owed one
  sentence about it.

The listing moved to `apps/worker/src/services/google/driveListing.ts` in the same change:
`drive.ts` decides what to land, and no longer knows Drive's query dialect, its paging, or
that a listing returns containers at all.

## Why

- **The one-level rule answered the right hazard the wrong way.** It was recorded in a
  docstring, a test and the product's own copy ("Only files directly inside a chosen folder
  are read. Sub-folders are not"), on the reasoning that a recursive walk can reach folders
  the admin never saw in the Picker, which would make the printed promise false. The hazard is
  real. But the remedy — the deeper read being impossible — left an admin who wanted a folder
  synced picking its files one at a time, and told them nothing about what they were giving up
  each time a new file landed in a sub-folder. A consent boundary is kept by asking and
  recording the answer, not by refusing to ask.
- **Silently widening a recorded consent is the one thing this must not do.** Recursing by
  default would, on deploy, make every Drive connection in the estate read more than its admin
  agreed to, with nobody having said so and nothing in the UI changed. That is rule 2 broken by
  the platform rather than by a value, which is why the toggle is opt-in and the field defaults
  false even for rows that predate it.
- **What is read is said while it is chosen, and read back afterwards.** "Sub-folders are not
  read" was a standing note above the picker because it was always true. It is now a line
  beneath the tick that changes with it (`role="status"`, the pattern `GmailChoice` already
  uses), the card distinguishes `scope.driveFolders` from `scope.driveFoldersDeep`, and a run
  that descended says so in its journal — `listed` beside `folders`, worded by
  `journal.event.picksListedDeep`. The shallow sentence ends "Sub-folders are not read", which
  would be a false statement on a run that read them.

## The open question, and how it fails

Whether `drive.file` cascades access from a picked folder to a **nested** folder is not
something Google's documentation states either way. A picked folder's direct children are
demonstrably readable — that is what ships today. The nested case is not.

It is deliberately not guessed at. A listing Google refuses raises through `api.getJson` as a
`ConnectorError` carrying the reason and how many records were seen, exactly as
`.claude/rules/connectors.md` requires, so the first recursive run says so plainly instead of
landing a subset of a customer's folder and calling itself green. If the field shows nested
listings are refused, the answer is a scope decision recorded as a new ADR — not a quiet skip
here.

## Rejected

- **Always recursive, no toggle.** Simplest code and no new field, and it silently widens every
  consent already recorded. Rejected for the reason above.
- **Opt-in, but defaulted on for saved scopes.** The same widening with an escape hatch
  afterwards, which is an escape hatch for a decision the admin never made.
- **Move to `drive.readonly`.** It would settle the nested question outright and let us list
  folders server-side. It is a Google _restricted_ scope: an annual CASA security assessment
  for the whole product, and a credential that can read a customer's entire Drive rather than
  what they picked. Not worth it for a depth setting; ADR 0015's reasoning for `drive.file`
  stands.

## Consequences

- `scopePicker.directChildrenOnly` is gone from both catalogues, replaced by
  `includeSubFolders`, `willReadOneLevel` and `willReadDeep`.
- `ConnectionCardView.config` carries the Drive picks as `{ id, name, kind }` in place of
  `folderIds: string[]`, plus `recurse`. The kind is what stops the scope picker rebuilding a
  directly-picked _file_ as a folder pick — which it did, so an admin who re-saved without
  re-picking turned their documents into folder picks that list nothing and refuse.
- A recursive run costs one Drive request per folder per page, where a shallow one cost one
  per picked folder. The pacer in `@undercroft/core` governs it as before.
