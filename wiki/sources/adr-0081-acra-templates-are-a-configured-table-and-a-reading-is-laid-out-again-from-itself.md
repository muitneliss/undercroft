---
title: >-
  ADR 0081: ACRA templates are a configured table, and a reading is laid out
  again from itself
type: source
date: 2026-09-29
tags: []
source: >-
  docs/adr/0081-acra-templates-are-configured-and-a-reading-is-laid-out-again-from-itself.md
source_path: >-
  docs/adr/0081-acra-templates-are-configured-and-a-reading-is-laid-out-again-from-itself.md
source_hash: 27c409f943b1cdb695fbc384f253a6a9c76a1ea40b435a5629653d646824f0a5
ingested: 2026-09-29
---

# ADR 0081: ACRA templates are a configured table, and a reading is laid out again from itself

Accepted 2026-09-29, for issue #313. Extends [[ADR 0048: A file is recognised by its type first, and a signed record is verified before it is read]] (a Business Profile is read only from a template it was written against) and [[ADR 0024: A document's text is readable by dbt]] (`raw.document_text` is a projection).

**Context.** ACRA now sells Business Profiles in the `BP-COMPANY-2024-1` template. Only `BP-COMPANY-2022-1` was read as `acraBusinessProfile`, so on 2026-09-29 production held 418 verified 2024 profiles as unwrapped `data`, beside 270 in the 2022 template. A model asking for a company's latest profile found none, or an older 2022 one. The 2024 template writes dates as `DD Mon YYYY`, renames `productCode` to `productId`, gives officers and shareholders `isNominee`, `entryDate` and `addressChanged` in place of `addressSource`, and adds registration and AGM dates, former names, charges and a QR code. The 418 texts were out of the backlog's reach, because `reader_version` re-queues refusals only.

**Decision.** (1) Each template is an entry in `apps/worker/src/services/extract/acraTemplates.ts`: its date form and a layout naming, for each profile key, the field it comes from (text, date, flag, list, nested record, or `absent`). The mapper knows no template or field name; an unlisted template stays `data`. (2) Each entry is written against its own template. The 2024 layout came from the key set and value shapes of all 418 profiles. An item with no confirmed field is `null`, so `productCode` is `null` and `productId` keeps its own name. (3) The 2024 profile carries every 2022 key in the same place, then its own; 2022 output is unchanged and pinned whole by a test. (4) Dates are read strictly in the template's own form; anything else, or a date not on the calendar, is `null`. (5) `raw.document_text` gains `layout_version` (`370_document_text_layout_version.sql`). An extract run lays out again each OpenAttestation text stamped older, from the verified data and verification it already holds, then stamps every text it looked at. A changed text takes the run's `run_id` and `extracted_at`; one that stayed keeps both. The scheduler counts such a scope as due.

**Rejected.** Template names in an environment variable (a name does not say what its fields mean). A migration deleting the 418 rows, as 350 did (the re-read verifies again over DNS, and a failed lookup would turn verified texts into refusals). Raising `CURRENT_READER_VERSION` (it does not reach read rows, and would re-read every refusal). Selecting texts by their JSON in SQL (the rules stated twice, and a text the mapper declines would keep its scope due for ever).

**Consequences.** Adding a template is an entry, a test document signed in its shape, and a raised `ACRA_LAYOUT_VERSION`, by hand like the reader version. The first run after release looks at each OpenAttestation text once, with no lake read and no DNS. The ledger counts a text laid out again as `changed`, not `created`. A date whose day or month no calendar has, such as `00/01/2024`, used to throw and fail the whole document; it now reads as `null`.
