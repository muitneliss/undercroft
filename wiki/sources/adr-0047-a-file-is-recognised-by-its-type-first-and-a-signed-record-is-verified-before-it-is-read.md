---
title: >-
  ADR 0047: A file is recognised by its type first, and a signed record is
  verified before it is read
type: source
date: 2026-09-24
tags: []
source: >-
  docs/adr/0047-a-file-is-recognised-by-its-type-first-and-a-signed-record-is-verified-before-it-is-read.md
source_path: >-
  docs/adr/0047-a-file-is-recognised-by-its-type-first-and-a-signed-record-is-verified-before-it-is-read.md
source_hash: 6a165d836d7b3993a4ea62b26768d636acdebb0a8eb8da3356938418ea650ba7
ingested: 2026-09-24
---

# ADR 0047: A file is recognised by its type first, and a signed record is verified before it is read

# ADR 0047: A file is recognised by its type first, and a signed record is verified before it is read

Accepted 2026-09-24, implementing issue #176. Builds on [[ADR 0031 A Picked Drive Folder May Be Read to the Bottom]] (no consent widens by deploying) and [[ADR 0024: A document's text is readable by dbt]] (what a reader writes is `raw.document_text`).

**Decision.** The Gmail/Drive picker grows from nine file types to twenty-one, listed once in `packages/contracts/src/fileFormats.ts`. The picker, both collectors, the worker's readers and `docs/reference/file-formats.md` all read that list, and tests fail when the docs page misses a format or an offered format has no reader. A file is matched by MIME type first. It is matched by name only when the type is `application/octet-stream`, and then only against an extension chosen as such (`.oa`): one to eight letters or digits after the last dot, at least one of them a letter. An extension never overrides or widens a MIME type. Google Docs, Sheets and Slides are exported as `.docx`, `.xlsx` and plain text. New readers: `.xlsm`, HTML, MIME messages (`.eml` and `.mhtml`), XML and Markdown as text, JSON, and WebP by OCR. The reader version rises to 3. A `.oa` lands as JSON, and a JSON document claiming the OpenAttestation schema is verified by `@tradetrust-tt/tt-verify` before any of it is read. Integrity, signature and DNS-DID issuer identity must all be VALID, or a named refusal is recorded with no text. A verified ACRA Business Profile (issuer at `acratrustbar.gov.sg`, template `BP-COMPANY-2022-1`) is written as a normalised profile; any other verified document is written as its unwrapped data. ZIP, RAR, HEIC and TIFF are not offered.

**Why.** Names lie: `Services Agreement for Mr. Smith` cut at the last dot is a `smith` file, and 77 of the 99 such names the reporter checked were Google Docs or Sheets with a good MIME type. The verifier is the official one because a home-made verifier certifies documents while disagreeing with the reference. `@trustvc/trustvc` was rejected under Bun (a missing `dotenv` dependency, a broken ESM entry, twice the install). A `did:ethr` key is resolved offline to its default ERC-1056 document, since an Ethereum RPC is a credential the platform lacks and the library's fallback would reach any URL a document names. On 2026-09-24 ACRA's key had no on-chain change. The DNS-DID lookup stays live, with the resolver injected. Values are unwrapped at the first two colons and kept as text, because `getData` turns `number:` values into floats (`money.md`). The ACRA profile is document text, not a table, because the platform ships no business schema.

**Consequences.** The worker's `node_modules` grows by about 150 MB and 378 packages, a supply-chain surface in the process holding `UNDERCROFT_SECRET_KEY`. It is accepted and pinned; moving the verifier into its own process is the step if the surface must shrink. A DNS outage refuses a document as `openattestation-could-not-verify`, which is retried only when the reader version next rises.
