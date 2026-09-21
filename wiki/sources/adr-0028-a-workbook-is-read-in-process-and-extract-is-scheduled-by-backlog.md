---
title: 'ADR 0028: A workbook is read in process, and extract is scheduled by backlog'
type: source
date: 2026-09-21
tags: []
source: >-
  docs/adr/0028-a-workbook-is-read-in-process-and-extract-is-scheduled-by-backlog.md
source_path: >-
  docs/adr/0028-a-workbook-is-read-in-process-and-extract-is-scheduled-by-backlog.md
source_hash: 0ac99b5326ebfd7bb16a4267419cf80e4335f3919d0eafce5f3823b48f8d57df
ingested: 2026-09-21
---

# ADR 0028: A workbook is read in process, and extract is scheduled by backlog

# 28. A workbook is read in process, and extract is scheduled by backlog

* Status: Accepted
* Date: 2026-09-21
* Implements: [ADR 0024](0024-extracted-text-is-readable-by-dbt.md), which created
  `raw.document_text` and named `xlsx` as a `method` no code ever produced, and defined the
  extract verb as its own run without saying who starts it

## Decision

Two decisions, from one investigation into why a spreadsheet synced from Google Drive was
never searchable.

1. **A `.xlsx` is read in this process, with no new dependency and no new binary.**
   `services/extract/zip.ts` reads the container and `services/extract/xlsx.ts` reads the
   OOXML. A `.xls` — the pre-2007 binary workbook — is refused by name as
   `legacy-xls-unsupported`.
2. **An extract run is due when there is work outstanding, not on a cadence.**
   `GET /v1/runs/extract-due` returns the `(tenant, source)` pairs holding a document nobody
   has read, and `flows/extract_due.yml` ticks it hourly.

`poppler-utils` also joins the worker image, which is not a decision so much as a correction:
`extractText.ts` has invoked `pdftotext` by name since ADR 0024 and the binary was never
installed, so every PDF on the server recorded `extractor-missing:pdftotext`.

## What was actually broken

Three faults, stacked, each of which alone made the feature invisible rather than loud. On the
production server, for tenant `case-001`:

* the Drive sync was **working** — `picks_listed matched:1`, `documents_landed created:1`,
  `run_closed status:ok`, and a correct 262 887-byte row in `raw.documents` with content type
  `…spreadsheetml.sheet`;
* `raw.document_text` held **zero rows**, and 72 hours of worker logs held no extract event,
  because nothing anywhere called `POST /v1/runs/extract`;
* had anything called it, `extractDocument` would have answered `unsupported-content-type`,
  because the dispatch handled `text/plain`, `application/pdf` and `application/msword` and
  nothing else;
* and `which pdftotext` in the running container answered "not found".

Every layer reported success. That is the failure mode `CLAUDE.md` rule 2 is about, arriving
through the harness rather than through a value: a green sync, a green run, a green gate, and
a Lake division truthfully printing "1 document, 0 readable" that nobody had a reason to read
as a defect.

## Why the workbook reader is ours

An `.xlsx` is a zip of XML. The alternatives were measured against that:

* **LibreOffice** — `extractText.ts` had already rejected it, in a comment, as "a container's
  worth of dependency for two files" when it declined to read `application/msword`. Accepting
  it for spreadsheets would have made that comment false rather than answered it.
* **`xlsx2csv`, `in2csv`** — both Python. `CLAUDE.md` permits an *invoked* Python binary (dbt
  is one) but each adds a venv, a pin and a second thing to upgrade, for a format whose
  container is 120 lines of `node:zlib`.
* **An npm library** — the real cost is not the bytes, it is that the worker is the one
  process holding `UNDERCROFT_SECRET_KEY`, and a transitive dependency there is a
  supply-chain surface for a file format we can parse exactly.

So the reader is deliberately **not** a zip library: no writing, no traversal, no streaming,
no encryption, no zip64. Anything it cannot read exactly returns `null` and becomes a recorded
reason, never a partial read — a half-parsed workbook is indistinguishable downstream from a
short one.

**Cell values stay strings, exactly as the file wrote them.** A spreadsheet is the likeliest
document in the platform to be full of amounts, and `Number("1234.10")` is `1234.0999999…`;
`money.md` exists for precisely this. Nothing in the reader parses a value. A date is left as
its serial for the same reason in a different direction: rendering it needs the workbook's
format table, the 1900/1904 epoch flag and a timezone this layer has no business choosing, and
a guessed date cannot be told from a real one.

Sheet **names** are not included. They live in `xl/workbook.xml` and bind to their parts
through `xl/_rels/workbook.xml.rels`; without walking both, "sheet1.xml is the first tab" is a
convention that usually holds, and usually is a guess.

## Why extract is scheduled by backlog and not by cadence

An ingest is due by the **clock** — a cadence the customer chose, whether or not anything
changed at the source. Giving extract a cadence of its own would start a run over a settled
tenant on every tick, forever, for a verb ADR 0024 measured at tens of minutes of CPU.

`pendingScopes` reuses the exact predicate `pendingDocuments` already used to decide which
documents a run reads — never read, or read from bytes whose `source_sha256` has changed,
excluding tombstones. Sharing it is load-bearing: two definitions of "pending" drifting apart
would appear as a flow that ticks forever over a tenant whose documents the run then declines
to read. A settled pair falls off the list and nothing is started for it, which is what makes
an hourly schedule cheap.

It stays a **separate flow** from `ingest_due`, not a chained task, for ADR 0024's reason
unchanged: chained, an ingest's duration becomes a function of how much reading is
outstanding, and a failed read looks like a failed sync — two facts wearing one status.

## Options rejected

* **Chain extract to the end of each ingest.** Rejected above, and by ADR 0024 before it.
* **Give the control plane a "read documents" button instead of a flow.** A button makes
  searchability a thing someone remembers to do. The Lake division's "N documents, M readable"
  is the report; it should not also be the trigger.
* **Ship `tesseract-ocr` in the same change.** `ExtractMethod` names `pdf_ocr` and
  `image_ocr`, but nothing dispatches to either. A 200 MB binary nothing calls is weight in
  the image and surface in the process; it arrives with the reader that needs it, and a scan
  keeps refusing as `needs-ocr` until then.
* **Let an unreadable workbook store its readable part.** A cut workbook that does not say it
  is cut reads as a complete one that simply lacks the row you were looking for. The truncation
  case that IS supported sets `truncated`, which is the difference.
