# 79. Xero reads bank transactions, bank transfers and manual journals

- Status: Accepted
- Date: 2026-09-28
- Extends: [ADR 0069](0069-xero-reads-every-list-its-granular-scopes-reach.md) and
  [ADR 0073](0073-a-list-its-grant-cannot-read-is-named-not-failed.md). Both stand unchanged;
  this is the next scope ADR 0073 said would "cost nothing at deploy".

## Context

The Xero consent asked for four read scopes: invoices, payments, contacts and settings. None of
them reaches `/BankTransactions`, `/BankTransfers` or `/ManualJournals`, so none of the three was
ever read (issue 308). They hold the money that moves without an invoice: spend and receive
money on a bank account (bank fees, interest, owner drawings), transfers between two of the
organisation's own accounts, and the journals an accountant writes by hand for period-end
adjustments. A model built on the lake saw none of it, and nothing said so. Its totals looked
complete.

Issue 271 asked for the three lists. ADR 0069 read only what the scopes then asked for reached.
Issue 277 then added the settings scope first, because an invoice line's account, tax type and
currency could not be resolved without it.

**Where each list's scope comes from.** Xero's OpenAPI document (`xero_accounting.yaml`) still
puts all three paths under the broad `accounting.transactions` and `accounting.transactions.read`
alone. Xero grants neither to an app created on or after 2 March 2026. Xero's granular scope
table splits the broad scope into `accounting.invoices`, `accounting.payments`,
`accounting.banktransactions` and `accounting.manualjournals`. It puts bank transactions and bank
transfers under `accounting.banktransactions`, and manual journals under
`accounting.manualjournals`. Each has a `.read` form. That table is therefore the only source
here. ADR 0073 shows it has been wrong once: it placed items under invoices, where live Xero
answers 401. It is taken here because nothing more specific exists, and ADR 0073 bounds the cost
of it being wrong: a list whose `readScope` a grant lacks is named, never requested.

## Decision

**The consent asks for `accounting.banktransactions.read` and `accounting.manualjournals.read`.**
Both are added to `auth.scopes` in `specs/connectors/xero.yaml` and to the Xero provider in
`oauthProviders.ts`. The spec declares three more lists, each read as the OpenAPI document says
its GET takes parameters:

| Entity              | Path                                 | Scope                              | Read                                               |
| ------------------- | ------------------------------------ | ---------------------------------- | -------------------------------------------------- |
| `bank_transactions` | `/BankTransactions`                  | `accounting.banktransactions.read` | paged, `pageSize`, `unitdp=4`; `If-Modified-Since` |
| `bank_transfers`    | `/BankTransfers?includeDeleted=true` | `accounting.banktransactions.read` | unpaged; whole every run                           |
| `manual_journals`   | `/ManualJournals`                    | `accounting.manualjournals.read`   | paged, `pageSize`; `If-Modified-Since`             |

All three set `failOnEmpty: false`, like the lists ADR 0069 added. Plenty of organisations have
no transfer and no manual journal.

**`/BankTransactions` takes `unitdp`, so it asks for 4 decimals**, for the reason issue 280
found on invoices: without it Xero rounds each line's unit amount to 2.

**`/BankTransfers` is read whole, deleted transfers included.** It takes no `page`. Its record
carries `CreatedDateUTC` and no change time, so no watermark could tell that a transfer changed
after it landed. Xero leaves a DELETED transfer out unless `includeDeleted=true` is sent. Without
it, a transfer deleted after it landed would stay in the lake as AUTHORISED: money that moved in
no ledger, and rule 2's invisible falsehood. With it, a deletion lands as a new version of the
record whose `Status` reads `DELETED`. It also takes `If-Modified-Since`, but that would filter
on a time the record does not show us, so the spec does not send it.

## Consequences

- A connection recorded before this change keeps its schedule and reads every list it read
  before. Each run names the three new lists as not granted, with the scope a reconnect would
  add. Its card stays connected, names the two scopes beside **Reconnect** (ADR 0074), and
  closes `succeeded`.
- After a reconnect, a default run reads twenty lists. That is at least three requests more per
  run, well inside Xero's 60 a minute.
- The first run after a reconnect reads the two incremental lists whole, as it does any list
  with no watermark.
- A model gets the bank side of the ledger: `BankTransactions` with their lines and bank account,
  `BankTransfers` with both legs' bank transaction ids, `ManualJournals` with their journal
  lines. Joining them to accounts, tracking and tax rates is the model's work, not this
  platform's.
- If live Xero refuses one of the three under the scope named here, as it did items (#276), the
  run meets a 401 on that list. The repair is the one ADR 0073 made for items: move its
  `readScope`.

## Rejected

- **Ask for the broad `accounting.transactions.read`, which the OpenAPI document names.** Xero
  grants it to no app created since 2 March 2026. A consent asking for it is refused at
  `login.xero.com` before the administrator reaches an organisation. `oauthProviders.test.ts`
  fails on it.
- **Read `/BankTransfers` incrementally on `If-Modified-Since`.** The record holds no change
  time to keep as a watermark, and a deleted transfer does not come back without
  `includeDeleted`. Either way the lake would keep a transfer Xero no longer has.
- **Read `/Journals` as well.** That is the system journal of every posting, under
  `accounting.journals.read`, and a different question: the general ledger rather than the
  documents. The issue asks for the documents, and nothing here needs the ledger yet.
- **Add one of the scopes now and the other later.** Each is a consent, and an organisation
  reconnects once for both.
