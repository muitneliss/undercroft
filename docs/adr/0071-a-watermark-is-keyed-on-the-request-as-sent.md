# 71. A watermark is keyed on the request as sent, declared or scoped

- Status: Accepted
- Date: 2026-09-28
- Supersedes, in part: the "`''` for an entity read exactly as its spec declares it" decision
  of ADR 0052. The rest of ADR 0052 stands, and so does ADR 0034: a watermark is still only
  handed back under the format it was written in.

## Context

Xero rounds each line item's `UnitAmount` (and an item's `UnitPrice`) to 2 decimals unless the
request carries `unitdp=4` ([Rounding in Xero](https://developer.xero.com/documentation/api-guides/rounding-in-xero)).
`xero.yaml` never sent it, so a bill line priced `0.2248` landed as `0.22`, and on some bills
the line amount followed it below the subtotal (#280). Production held 5,390 invoice lines and
70 credit-note lines, and none had more than 2 decimals.

Adding `unitdp: "4"` to the query repairs every document read from then on. It does not repair
the ones already in the lake. Most Xero lists are incremental on `If-Modified-Since`, so the
next run asks only for what changed since the stored watermark. A bill nobody has edited keeps
the rounded price.

ADR 0052 already made a watermark belong to the request it was read with:
`raw.sync_cursor.request_key`, and a changed request finds no mark. But it keyed only a request
that a SCOPE had changed. An entity read as its spec declares it got `''`, so that every cursor
written before the column existed stayed valid across that deploy. That also made a change to
the spec itself invisible to the cursor, and a spec edit is exactly what #280 is.

## Decision

**The request key is always a digest of the request as sent.** `requestKey(spec, entity)` in
`packages/connector-runtime/src/incremental.ts` is SHA-256 over the canonical JSON of the base
URL, the entity's `request` (method, path, query, body, batch read) and the spec's
`defaults.headers`. It is computed the same way whether the entity is the spec's own or one a
scope reshaped, so a spec edit and a scope change are the same event: the key moves, the stored
mark no longer matches, and the stream reads everything once. An unchanged request keeps its
mark.

It lives in the runtime because the runtime is what knows what a request is made of. The worker
stores the key beside the mark and never looks inside it. `specRun.ts` loses `requestKeyOf` and
the identity comparison it made against the declared entity, and `EntityRead` goes with it: the
key is a function of the entity a run reads, so a run hands `runPaths.ts` entities alone.

What the key leaves out does not change what a record is answered AS: pagination, pacing,
guards, envelope and id paths, and the `incremental` block (a changed `format` already finds no
mark, ADR 0034). So is everything resolved per run or per connection: the token, which rotates,
and the account header. A key that moved with those would forget every mark on every refresh.

`xero.yaml` sends `unitdp: "4"` on `/Invoices`, `/CreditNotes`, `/Overpayments`,
`/Prepayments` and `/Items`, which are the lists it reads whose endpoint Xero's OpenAPI document
declares `unitdp` on. `/Quotes`, `/PurchaseOrders` and `/RepeatingInvoices` carry line items but
declare no `unitdp`, so they are left alone. Quotes in production already carry 4 decimals.

No migration. The column keeps its `DEFAULT ''`, and a row still holding `''` matches no key,
because a SHA-256 hex digest is never empty. It reads in full once and the next write replaces
it.

## Consequences

- The first run of every connection after this release reads each incremental stream in full,
  once. For Xero that is the repair: every document re-lands with 4-decimal unit prices,
  without anyone reconnecting. A record whose bytes changed lands as a new version, and one
  whose bytes did not lands as `unchanged`. The lake's create-only, idempotent-by-content rules
  are untouched. The run is longer: about one request per hundred records per list, at Xero's
  1100 ms pacing, which the full read that `320_xero_reread.sql` forced after #268 already
  showed a connection can absorb.
- HubSpot's streams lose their marks too, and that costs no extra request. They are read with
  `client-filter`, which pages the whole source every run anyway. What a lost mark costs there
  is landing each record once more, as `unchanged`. A scoped HubSpot entity's key also changes
  (from a digest of the request alone to this one), with the same one-off cost.
- A future spec edit to a request re-reads that list once, by itself. A one-off like
  `320_xero_reread.sql` is no longer needed for a spec change. It is still needed for a RUNTIME
  change that alters answers without altering the spec, as #268's first-page fix did, because
  no key over the spec can see that.
- Formatting a spec does not re-read anything. The digest is over canonical JSON, so reordering
  YAML keys or reflowing a line leaves it where it was.

## Options rejected

- **A numbered migration that forgets Xero's cursors, as `320_xero_reread.sql` did.** Smallest
  diff, and it would work once. It leaves the gap that caused this: the next spec edit to a
  request needs someone to notice that stored marks now vouch for records the new request never
  asked about, and to write the one-off again. Nobody noticed this time until a customer's
  totals disagreed.
- **A hand-bumped `revision` on each entity in the spec.** It works, but it grows the connector
  format to carry a fact the spec already states, and it relies on the person editing the
  request remembering to bump it. Forgetting fails silently, exactly as this bug did.
- **Keep `''` for the declared request and key only on spec edits made from now on.** There is
  no way to tell a `''` row written under yesterday's request from one written under today's,
  so a transition rule has to either trust every `''` row, which leaves #280 unrepaired, or
  distrust every one, which is this decision.
- **Include the `pagination` block in the key.** Changing how pages are walked changes which
  requests are sent, not what a record is answered as, so it would re-read a list for no
  reason. A page size written in the query, as Xero's `pageSize` is, is part of the request and
  does move the key. That costs one full read when someone tunes it, which is rare.
