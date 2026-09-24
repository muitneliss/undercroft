# 47. A file is recognised by its type first, and a signed record is verified before it is read

- Status: Accepted
- Date: 2026-09-24
- Implements: issue #176

## Decision

The Gmail and Drive picker grows from nine file types to twenty-one, and they are listed once,
in `packages/contracts/src/fileFormats.ts`. The picker, both collectors, the worker's readers
and `docs/reference/file-formats.md` all read that one list. A test fails when the docs page
misses a format, and another fails when an offered format has no reader. Five parts of the
decision carry weight.

**A file is matched by MIME type first, and by name only when the type is
`application/octet-stream`.** In that case only an extension the admin chose as an extension
counts (`.oa`). An extension is one to eight letters or digits after the last dot, with at least
one letter. It never overrides a MIME type and never widens one. A scope stores either a MIME
type, exactly as before, or `.ext`.

**A Google Doc, Sheet or Slides file is exported.** A Doc lands as `.docx`, a Sheet as `.xlsx`
and Slides as plain text, each catalogued under the export's type and read by the reader for
that type. The record keeps Drive's own type.

**New readers:** macro-enabled workbooks (the `.xlsx` reader), HTML, MIME messages (`.eml` and
`.mhtml` through one parser), XML and Markdown as text, JSON, and WebP by OCR. The reader
version rises to 3, so every document these types once refused as `unsupported-content-type`
is offered again once.

**A `.oa` file lands as JSON, and a JSON document claiming the OpenAttestation schema is
verified before any of it is read.** The verifier is `@tradetrust-tt/tt-verify`. Integrity,
signature and DNS-DID issuer identity must all be `VALID`. Otherwise the refusal names what
failed and no text is stored. A verified ACRA Business Profile is written as a normalised
profile. Any other verified document is written as its unwrapped data.

**ZIP, RAR, HEIC and TIFF are not offered.** Nothing reads them.

## Why

### MIME first, because names lie

The issue's own Drive had 110 files whose names hold a dot but no extension. Cut at the last
dot, `Services Agreement for Mr. Smith` becomes a `smith` file, and that misreading filed eight
service contracts as something else in the reporter's own index. Of 99 such files the reporter
checked, 77 were Google Docs or Sheets with a perfectly good MIME type. The name is therefore
the last thing consulted, and only for the one type that says nothing.

### Why an extension does not widen a MIME choice

A PDF-only scope could have been widened to also take an octet-stream file named `*.pdf`. That
would widen every recorded consent in the estate on deploy, which ADR 0031 and the `FileTypes`
default both refuse. A name becomes a match only where an admin chose the name.

### Why the official verifier, and which one

GovTech archived `@govtechsg/oa-verify` and ended OpenAttestation maintenance on 1 October 2025.
IMDA's TradeTrust packages are its maintained successors, and `@trustvc/trustvc` wraps them.
Three versions of the wrapper were rejected under Bun 1.4.2:

- Its root import pulls in `dotenv/config` without depending on it, and would read a `.env`.
- Its `/verify` entry fails to load under Bun (`export 'CredentialStatusResult' not found`).
- It installs twice the dependency tree.

The worker therefore depends on `@tradetrust-tt/tt-verify` and `@tradetrust-tt/dnsprove`
directly. They are the same code from the same maintainer.

Writing the Merkle and signature checks by hand was rejected outright. A verifier that passes
its own tests while disagreeing with the reference implementation is the most expensive kind of
wrong, because it certifies documents.

### Why the DID is resolved offline and the DNS is not

The library resolves a `did:ethr` key by reading the ERC-1056 registry through an Ethereum RPC.
It defaults to Infura with a key baked into the package. We rejected that for two reasons:

- It is a credential and a network dependency the platform does not have.
- Any DID the injected resolver does not answer falls back to the library's network resolver,
  so an arbitrary DID method would reach an arbitrary URL.

Instead, a `did:ethr` key resolves to the default document ERC-1056 defines for an unchanged
key. Every other issuer shape is refused before any lookup. The cost is stated in the module and
the docs: a key re-assigned on-chain is not seen. On 2026-09-24 the registry's `changed()` for
ACRA's key returned 0, so for ACRA today the two readings are identical.

The DNS-DID check stays live, over dnsprove's DNS-over-HTTPS resolvers, because it is what binds
the key to the issuer's domain. The stock verifier cannot be handed a resolver, so its comparison
is re-stated with the lookup injected. That is what lets the offline gate test it with no
network.

### Why values are unwrapped by hand

`getData` returns a `number:` value as a JavaScript float. A share capital is money, and
`money.md` forbids it ever being a float. The salt is therefore removed at the first two colons
and the value kept as text. Splitting at the last colon was also rejected: it turns
`https://renderer...` into `//renderer...` and `did:ethr:0x...` into `0x...`.

### Why an ACRA profile is text and not a table

`CLAUDE.md` forbids shipping business schema. The profile is the document's text in
`raw.document_text`, as a PDF's words are. A customer's dbt model can parse it or ignore it. It
applies only when every issuer proves itself at `acratrustbar.gov.sg` and the template is
`BP-COMPANY-2022-1`. That check comes after verification and grants no trust of its own. Any
other template keeps the generic data, because assuming a new template's fields mean what this
one's do is a guess.

### Why the handoff's other suggestions are not here

A trust-policy configuration, metrics and a separate upload endpoint have no caller in a
platform whose only way in is the collectors.

## Consequences

- The worker's `node_modules` grows by about 150 MB and 378 packages: ethers v5 and v6, the W3C
  verifiable-credential stack, and native modules whose install scripts Bun skips. This is a
  supply-chain surface in the process that holds `UNDERCROFT_SECRET_KEY`, the concern `zip.ts`
  names. It is accepted because a verifier is the one piece of this change that must not be
  home-made. It is pinned exactly, and moving it into its own process is the step to take if the
  surface ever has to shrink.
- If the DNS lookup fails, a document is refused as `openattestation-could-not-verify`. Like
  every refusal, it is offered again only when the reader version next rises. A transient outage
  therefore needs a version bump or a re-land to clear.
- An `unsupported-content-type` refusal still does not carry the type in its reason, but the
  document row does. The run ledger shows the reason, and the catalogue shows the type.
