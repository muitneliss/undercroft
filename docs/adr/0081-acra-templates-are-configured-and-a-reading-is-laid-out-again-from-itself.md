# 81. ACRA templates are a configured table, and a reading is laid out again from itself

- Status: Accepted
- Date: 2026-09-29
- Extends: [ADR 0048](0048-a-file-is-recognised-by-its-type-first-and-a-signed-record-is-verified-before-it-is-read.md)
  (a Business Profile is read only from a template it was written against) and
  [ADR 0024](0024-extracted-text-is-readable-by-dbt.md) (`raw.document_text` is a projection).
- Issue: [#313](https://github.com/muitneliss/undercroft/issues/313)

## Context

ACRA now sells Business Profiles in a `BP-COMPANY-2024-1` template. ADR 0048 read only
`BP-COMPANY-2022-1` as `acraBusinessProfile`, and read every other template as the unwrapped
`data`. That was deliberate, because assuming a new template's fields mean what an old one's do
is a guess. On 2026-09-29 production held 418 verified 2024 profiles stored as `data`, beside
270 profiles in the 2022 template. So a model that asks for a company's latest profile found
none, or found an older 2022 profile instead.

The 2024 template is not the 2022 one with a new name. Its dates are `DD Mon YYYY`. `productCode`
became `productId`. Officers and shareholders gained `isNominee`, `entryDate` and
`addressChanged`, and lost `addressSource`. The template also adds registration and AGM dates,
former names, charges and a QR code. A shared mapping would have read none of that correctly.

The 418 texts are also out of the extract backlog's reach. `reader_version` re-queues refusals
only, because a cheap re-run that overwrote good text is the worst extraction bug on record, and
these rows were read.

## Decision

1. **A template is an entry in a table, not a branch in code.**
   `apps/worker/src/services/extract/acraTemplates.ts` gives each template its date form and a
   layout: each profile key, and the field of that template it comes from. A key can come from
   text, a date, a flag, a list, a nested record, or nothing (`absent`). The mapper
   (`acraBusinessProfile.ts`) knows no template name and no field name. A template that is not
   in the table is still read as `data`.
2. **Each entry is written against its own template.** The 2024 layout came from the key set
   and value shapes of all 418 production profiles, surveyed by shape only. An item the 2024
   template has no confirmed field for is `null`, and is not borrowed from a field with a
   similar name. So `productCode` is `null`, and `productId` is kept under its own name.
3. **One profile shape.** The 2024 layout carries every key of the 2022 layout, in the same
   place, and adds its own keys after them. So a model reads both templates with the same SQL.
   The 2022 output is unchanged, and a test pins it whole.
4. **Dates are read strictly in the template's own form.** `DD Mon YYYY` means exactly a
   two-digit day, `Jan` to `Dec`, and a four-digit year. Anything else, or a date not on the
   calendar, reads as `null`.
5. **A reading is laid out again from itself, never re-read.** `raw.document_text` gains
   `layout_version`. Every write stamps it with the generation of the template table. An extract
   run lays out again each OpenAttestation text stamped older, from the verified data and
   verification the text already holds. It then stamps every text it looked at, whether the
   text changed or not. A text that changed carries this run's `run_id` and `extracted_at`. A
   text that stayed keeps both, and gets only the new stamp. The scheduler counts a scope that
   holds such texts as due.

## Options rejected

- **A list of template names in an environment variable.** A name does not say what its fields
  mean or how it writes a date. Enabling a template by name would read it with another
  template's mapping, which is exactly the guess ADR 0048 forbids.
- **A migration that deletes the 418 rows, as `350_document_text_tool_remarks.sql` did.** The
  extract backlog would re-read them from the lake, and an OpenAttestation read verifies again
  over DNS. If the lookup failed in that hour, 418 verified texts would become
  `openattestation-could-not-verify` refusals, and they would stay refusals until the next
  reader generation. The re-layout needs neither the network nor the lake.
- **Raising `CURRENT_READER_VERSION`.** That would not reach these rows, because they were read.
  It would also re-read every refusal on production, including the OCR ones, to change none of
  them.
- **Choosing the texts to lay out again by their JSON, in SQL.** That would state the template
  and issuer rules a second time, in SQL. A text that matched the SQL but not the mapper, such
  as a profile with no UEN, would keep its scope due on every scheduler tick. A stamp reaches
  each text once.

## Consequences

- **Adding a template** means an entry in `acraTemplates.ts`, a test document signed in its
  shape, and a raised `ACRA_LAYOUT_VERSION`. The constant is raised by hand, like
  `CURRENT_READER_VERSION`. If it is forgotten, the new template reads new documents but does
  not reach texts already read.
- **The first run after the release looks at every OpenAttestation text once.** On the one
  production tenant surveyed, that is 718 rows. No bytes are fetched and no DNS lookup is made.
- **The ledger counts a text laid out again as `changed`** on the run's `documents` row, and not
  as `created`, because nothing was read.
- **A date with a day or month that no calendar has**, such as `00/01/2024` or `01/13/2024`, used
  to throw from `toISOString` and fail the whole document. It now reads as `null`, like any other
  impossible date.
