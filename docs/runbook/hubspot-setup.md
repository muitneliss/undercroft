# Setting up HubSpot ingestion

Connecting a customer's HubSpot portal, which permissions its private app needs for each kind
of data, and how to check each step worked.

> **This is not sign-in.** Signing in is set up in [sign-in-setup.md](./sign-in-setup.md). This
> reads a customer's CRM, per tenant, with a token their HubSpot administrator creates. The
> worker seals it into `app.connection_secret`.

## 0. What is different about HubSpot

- **There is no consent screen.** A HubSpot administrator creates a _private app_ in the
  customer's portal and copies its access token, and an Undercroft admin pastes it on the
  customer's Sources leaf. The token is checked with HubSpot before it is stored.
- **The permissions live in HubSpot.** A private app reads what its scopes allow, and they are
  ticked in HubSpot. Undercroft does not record them, so it cannot know in advance what the
  token can read.
- **A missing permission costs one list, not the run.** When HubSpot refuses a list because the
  token lacks a scope, the run skips that list and reads the rest. The Journal names the list
  and the scope to add, and the run still succeeds.
  [ADR 0075](../adr/0075-hubspot-reads-its-commerce-objects-and-names-a-list-its-token-cannot-read.md).

## 1. Create the private app, with these scopes

In the customer's HubSpot portal: **Settings → Integrations → Private apps → Create a private
app**. On its **Scopes** tab, tick the read scopes for the data you want. Each entity in
`specs/connectors/hubspot.yaml` names the scope it is read under (`readScope`), and this table
lists the same.

| Data in the lake                                 | Lake entities                                                                                                                                                                                                                                  | Scope to tick                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Companies                                        | `companies`                                                                                                                                                                                                                                    | `crm.objects.companies.read`  |
| Contacts                                         | `contacts`                                                                                                                                                                                                                                     | `crm.objects.contacts.read`   |
| Deals, and the deal pipelines with their stages  | `deals`, `deal_pipelines`                                                                                                                                                                                                                      | `crm.objects.deals.read`      |
| Quotes                                           | `quotes`                                                                                                                                                                                                                                       | `crm.objects.quotes.read`     |
| Line items                                       | `line_items`                                                                                                                                                                                                                                   | `crm.objects.line_items.read` |
| Products, archived ones included                 | `products`                                                                                                                                                                                                                                     | `e-commerce`                  |
| Owners, deactivated ones included                | `owners`                                                                                                                                                                                                                                       | `crm.objects.owners.read`     |
| Notes                                            | `notes`                                                                                                                                                                                                                                        | `crm.objects.contacts.read`   |
| Calls, and what each call outcome means          | `calls`, `call_dispositions`                                                                                                                                                                                                                   | `crm.objects.contacts.read`   |
| Tasks, open and completed                        | `tasks`                                                                                                                                                                                                                                        | `crm.objects.contacts.read`   |
| Links between records (each with kind and label) | `associations` (deal→company), `contact_companies`, `deal_contacts`, `deal_quotes`, `deal_line_items`, `quote_line_items`, `quote_contacts`, `quote_companies`, and `note_*`, `call_*`, `task_*` (each to `companies`, `contacts` and `deals`) | the scopes of both objects    |

Notes on the table:

- **Products.** HubSpot's scope reference lists `e-commerce` for the products and line items
  endpoints. The products API also accepts `crm.objects.products.read`. If the private app's scope
  list offers that one and not `e-commerce`, tick it instead.
- **Quotes and line items** are also readable with `e-commerce`, but tick the two
  `crm.objects.*.read` scopes above: they are the ones the Journal names if either is missing.
- **Links.** A link is read against the record it hangs off: `contact_companies` against
  contacts, `quote_*` against quotes, `deal_*` against deals. Tick the scopes of both objects.
  If the record's own list is not granted, its links are not read either, and the Journal names
  them with the same scope.
- **Deal pipelines** are readable with any of many CRM scopes; `crm.objects.deals.read` is enough.
- **Notes, calls and tasks** have no scope of their own: HubSpot reads all three with
  `crm.objects.contacts.read`, so ticking it for contacts also grants them. Without it, the
  Journal names `notes`, `calls` and `tasks` (and their links) with that scope, and the run reads
  the rest. HubSpot's reference names no scope for the call outcomes; they are read with the same
  one.

Then **Create app** and copy the access token.

## 2. Paste the token

As an admin, open the customer's Sources leaf, choose **HubSpot**, and paste the token. The
worker reads one company to check it. A token HubSpot rejects is refused before it is stored. An
outage is reported as an outage, not as a wrong token.

## 3. Optionally, choose more properties

Each object reads a standard set of properties. **Change what syncs** on the card adds more, the portal's
own included. It never takes one away. Companies, contacts, deals, quotes, line items, products,
notes, calls and tasks can each be widened. Owners, pipelines, call outcomes and links have no
properties to choose. The text of a note, call or task is not offered, because it lands as a
document rather than a property, and neither is anything section 6 says is never read. An object the token
may not read is left out of the list. If the token may read no object at all, the page says the
token lacks permission.

## 4. Run, and verify

1. Press **Run now**. The Journal shows each entity as it is read.
2. A portal with no quotes, line items, products, notes, calls or tasks reads `0` for those lists. That is not a
   failure. An empty first read of companies, contacts, deals, owners or pipelines is a failure.
3. A line such as "quotes was not read: the HubSpot private app's token lacks
   `crm.objects.quotes.read`" means that scope is missing. Its links (`deal_quotes`, `quote_*`)
   are named the same way. Everything else in the run landed.
4. To add a scope later, tick it on the private app in HubSpot and save. If HubSpot shows a new
   access token, paste the new one on the Sources leaf. The next run reads the list, and on its
   first read it lands every record and every link.

## 5. What each failure looks like

| Symptom                                             | Cause                                                      | Fix                                       |
| --------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| Pasting the token is refused                        | HubSpot rejected it: mistyped, rotated or deleted          | Copy the token again from the private app |
| A list in the Journal says "not granted"            | The private app lacks that list's scope (section 1)        | Tick the scope in HubSpot                 |
| Every list says "not granted" and the run fails     | The private app has none of the scopes                     | Tick the scopes in section 1              |
| The property picker says the token lacks permission | The private app can read none of the nine objects          | Tick at least one object's scope          |
| A run fails after 0 records with a 401              | The token was revoked or rotated in HubSpot                | Paste the current token                   |
| A run fails with a 403 that is not "not granted"    | HubSpot refused for another reason (e.g. portal suspended) | Read the run's error; check the portal    |

## 6. What is read of a note, a call and a task

- **Every one that is not deleted**, open and completed tasks alike, with its time, owner
  (`hubspot_owner_id`, an owner's `id`), the user who logged it (`hs_created_by`, an owner's
  `userId`; `owners` holds deactivated owners too), and every company, contact and deal it is
  logged on. A
  call carries its direction, duration, status and outcome (`hs_call_disposition`, a GUID that
  `call_dispositions` turns into a label). A task carries its subject, status, priority, type and
  due date (`hs_timestamp`). A note keeps HubSpot's references to its attached files
  (`hs_attachment_ids`); the files themselves are not read.
- **The text a person wrote is a document, not a property.** `hs_note_body`, `hs_call_body` and
  `hs_task_body` never appear in the record's payload. Each lands as a document of its record,
  `notes:<id>:body`, `calls:<id>:body` or `tasks:<id>:body`, exactly as a Gmail message's body does
  ([ADR 0084](../adr/0084-a-gmail-harvest-lands-each-messages-body.md),
  [ADR 0101](../adr/0101-a-spec-lands-the-text-a-person-wrote-as-a-document-of-its-record.md)). An
  item with no text has no document, and an edited text lands as a new version under the same id.
  A text cleared in HubSpot keeps its last document: nothing is landed in its place. Once the
  extract verb has read it, a tenant's model reads the
  text in `raw.document_text`, which the BI role cannot read:

  ```sql
  select r.source_record_id as note_id, t.text
  from {{ source('undercroft', 'records') }} r
  join raw.document_text t
    on t.source = r.source and t.tenant_id = r.tenant_id
   and t.document_id = 'notes:' || r.source_record_id || ':body'
  where r.source = 'hubspot' and r.entity = 'notes' and r.deleted_at is null
  ```

  An item deleted in HubSpot is marked deleted at source on the next run, and its document is
  kept: filter on the record's `deleted_at`, as above, to leave deleted items out.

- **Recordings and transcripts are never read.** No call's audio is downloaded and no transcript
  API is called. The property picker does not offer a call's recording URL, transcript or summary,
  or the preview copies of an item's text, and a run drops them from a scope even if one was saved
  over the CLI.
