# 68. A watermark is sent in the dialect the source's filter reads

- Status: Accepted
- Date: 2026-09-27
- Supersedes, in part: the "stored and sent back VERBATIM" decision of ADR 0034. It still
  holds for storage. Sending is now what this ADR says.

## Context

ADR 0034 stores a watermark as the provider's own text and sends that text back, on the
premise that "Xero's `If-Modified-Since` is a datetime string". Half of that is true. Xero
**reads** `If-Modified-Since` as RFC 3339 (its OpenAPI description declares the header
`format: date-time`). But it **writes** every date in its records as a Microsoft JSON date:
`"UpdatedDateUTC": "/Date(1573755038314+0000)/"`. So the string Xero wrote is not one it
accepts back.

Issue #265 is what that premise cost, twice over:

- `updatedAtPath: UpdatedDateUTC` passed `/Date(...)/` through to `raw.records.source_updated_at`,
  a `timestamptz`. Postgres refused it, so the first Xero run failed on its first page and
  landed nothing. The manifests that run had already written into the lake carry the same text.
  They cannot be rewritten, and landing the same bytes again writes no new manifest, so every
  later projection pass met them and failed the same way.
- `incremental.format` knew only `iso8601`, `epoch-millis` and `yyyy-mm-dd`. `Date.parse`
  returns `NaN` for `/Date(...)/`, so the watermark never advanced and every Xero run was a
  full read. That was safe, but it was not what the spec said it did.

## Decision

**One reader of timestamp text, in `@undercroft/core` (`instant.ts`).** `isoInstant` reads
ISO-8601 with a `Z` or an explicit offset, and hands it back unchanged. It also reads a
Microsoft JSON date and renders it as ISO-8601 UTC. The count in `/Date(...)/` is milliseconds
since the UTC epoch; the offset after it says where the value was written and does not move
it. Anything else is `null`: a date with no time, a time with no offset, `"March 7"`, and
`2026-02-30`, which Bun's `Date.parse` rolls over to March. Two callers use it:

- the connector runtime, for `sourceUpdatedAt`, so a new manifest carries an instant;
- `loadToRaw`, for every manifest it projects, so the ones already in the lake project too.
  Text that names no instant becomes `NULL`, which the column already defines as "the source
  did not say". It no longer fails the batch and holds back the stream's cursor for ever.

The record's payload keeps `/Date(...)/` exactly as Xero wrote it. Only the column is parsed.

**`incremental.format: ms-json-date`** orders a watermark by the count inside `/Date(...)/`,
as a `bigint`, which is the same scale as `epoch-millis`.

**`incremental.send`: `verbatim` (the default) or `rfc3339-seconds`.** The cursor still stores
the source's own text under its `format`. `send` only decides what goes into the `param` or
`header`. `rfc3339-seconds` renders the instant the watermark names as UTC, rounded down to
the second: `2019-11-14T18:10:38Z`. It rounds down because a watermark may ask for more but
never for less; the records in that second land again as `unchanged`. It drops the fraction
because Xero filters to the second and older integrations report that it refuses one.
`xero.yaml` declares `format: ms-json-date` and `send: rfc3339-seconds` on all four entities.

A watermark `rfc3339-seconds` cannot render raises a `ConnectorError`. Sending no header would
be a full read with `failOnEmpty` relaxed by the watermark, which is the combination
`checkIncremental` already refuses.

## Why the part of ADR 0034 that stands still stands

Its objection was to **storing** a re-rendered value: comparing two renderings of an instant
that may disagree, and handing a provider a string it never wrote as if it had. Storage is
unchanged: the cursor holds Xero's text, and `format` still invalidates it if the spec changes.
What changes is only the moment of sending, and only for a spec that asks. Sending HubSpot's
epoch milliseconds verbatim is still right, because HubSpot reads the same dialect it writes.

## Rejected

- **Send `/Date(...)/` verbatim now that it can be ordered.** The cursor would advance, and the
  second run would send Xero a header it does not read. That either fails the run or is
  silently ignored, and a filter that is silently ignored is a full read that looks incremental.
- **Tie the rendering to `format` (every `ms-json-date` watermark is sent as RFC 3339).** That
  is shorter, but it hides a fact about one provider's filter inside a statement about how its
  records are written. The next source that writes one dialect and reads another would inherit
  a rendering nobody chose.
- **Add `updatedAtFormat` to the entity.** `loadToRaw` reads manifests with no spec at hand, and
  it has to read the ones already in the lake. The two spellings `isoInstant` accepts cannot be
  mistaken for each other, so reading either one involves no guess.
- **Raise on an unreadable `updatedAt`.** That is how #265 lost the whole run. The value is
  metadata about a record that is otherwise fine, and `NULL` already means "not said".
