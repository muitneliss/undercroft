# Setting up Gmail and Drive ingestion

Standing up the per-tenant Google consent from nothing, with a way to check each step
actually worked.

> **This is not sign-in.** Signing in asks Google for `openid email profile` and is set up in
> [sign-in-setup.md](./sign-in-setup.md). This asks for a customer's mailbox or documents, per
> tenant, and its credentials are sealed into `app.connection_secret` by the worker. They use
> **two different Google clients on purpose** — one client carrying both scope lists is one
> misconfiguration away from handing over a mailbox as a side effect of signing in. The
> reasoning is in [ADR 0016](../adr/0016-the-worker-seals-the-control-plane-consents.md).

---

## 0. Read this before you start: verification is the long pole

`gmail.readonly` is a Google **restricted** scope. Until the OAuth client is verified you are
capped at 100 test users behind an unverified-app interstitial, and restricted scopes
additionally require a **security assessment (CASA)** that is repeated every twelve months.
That is weeks of calendar time and a real invoice, and no amount of code changes it.

`drive.readonly`, which Drive uses here, is **also restricted**. It adds no second assessment:
CASA covers the OAuth client, and this client needs it for Gmail anyway. Drive used
`drive.file`, which is not restricted, until
[ADR 0047](../adr/0047-drive-reads-with-drive-readonly.md). Under `drive.file` a folder picked
in Google's Picker does not grant the files already in it, so no folder could be read.

**Upgrading from a release before ADR 0047:** every Drive connection holds a `drive.file`
grant. Its card reads "needs reconnect", and each of its runs fails with a reason that says to
reconnect the source. An admin reconnects the source once and approves read access on Google's
screen. Add `drive.readonly` to the consent screen (step 3) before anyone does.

The whole surface is gated on `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID`. With it unset, the
feature is dormant: every Google source reads "not connected" and no button leads anywhere.
You can deploy and start verification in parallel.

## 1. Create the ingestion OAuth client

Google Cloud Console → **APIs & Services** → **Credentials** → **Create credentials** →
**OAuth client ID** → **Web application**.

Name it something that cannot be confused with the sign-in client, e.g. `undercroft-ingest`.

Under **Authorized redirect URIs**, add one line per origin. The path is ours and is fixed:

```
http://localhost:13000/oauth/google/callback
https://your-domain/oauth/google/callback
```

**Add no Gmail or Drive scope to the sign-in client, and no identity-only client here.**

## 2. Enable the APIs

**APIs & Services** → **Library** → enable **Gmail API**, **Google Drive API**, and
**Google Picker API**.

## 3. Add the scopes to the consent screen

**OAuth consent screen** → **Data access**:

| Source | Scope                                            | Classification                                           |
| ------ | ------------------------------------------------ | -------------------------------------------------------- |
| Gmail  | `https://www.googleapis.com/auth/gmail.readonly` | restricted — CASA                                        |
| Drive  | `https://www.googleapis.com/auth/drive.readonly` | restricted — CASA (the same assessment as Gmail's)       |
| both   | `openid`, `email`                                | identity, so the callback learns which account consented |

## 4. Create the Picker API key

**Credentials** → **Create credentials** → **API key**. Restrict it to the **Google Picker
API** and to your origins.

Note your **project number** (Cloud Console home page) — the Picker needs it as its app id.

An API key and a client id are public values: they identify the app and authorise nothing.
The client **secret** is not one of them and never reaches the browser.

## 5. Set the environment

```sh
UNDERCROFT_GOOGLE_INGEST_CLIENT_ID=...apps.googleusercontent.com
UNDERCROFT_GOOGLE_INGEST_CLIENT_SECRET=...
UNDERCROFT_GOOGLE_PICKER_API_KEY=...       # Drive's browser picker only
UNDERCROFT_GOOGLE_PROJECT_NUMBER=...       # ditto
```

Both the control plane and the worker need the client id and secret: the control plane runs
the consent, the worker refreshes the token afterwards. Only the control plane needs the
Picker pair.

The control plane also needs `UNDERCROFT_WORKER_URL` and `UNDERCROFT_TRIGGER_TOKEN`, which
the compose files already set. Without them the consent cannot be sealed and the flow stays
dormant.

## 6. Walk it, and check the trail

1. Sign in, open a tenant, and press **Connect** on Gmail.
2. You should land at Google's consent screen — check the URL carries `access_type=offline`
   and `prompt=consent`. Without both, Google issues no refresh token and the connection
   dies at the first expiry with nothing to renew it.
3. Approve. You should be returned to the scope picker.
4. Choose a label or two and save.

Then confirm, in `psql`:

```sql
-- connected, and an opaque numeric sub -- NOT an email address
SELECT status, external_account_id FROM ops.connection;

-- exactly one sealed credential; the control plane cannot open it
SELECT count(*) FROM app.connection_secret;

-- the mailbox address lives here, where BI has no USAGE
SELECT account_label, selection FROM app.connection_detail;

-- who did what
SELECT action, actor FROM ops.audit_log ORDER BY at DESC LIMIT 5;
```

## 7. Run an ingest

Press **Run now** on the source's card (an admin sees it). The card shows _Running_ and
polls; when the run ends the mark flips and the line reads the count landed and when the
next run is due. The **Journal** division lists the run, and opening its row shows the
per-entity counts and any record the pipeline refused, with the reason. A second _Run now_
while one is in progress is refused with the running run's id, not queued.

The worker's HTTP verb behind the plate is on the compose network only; nothing publishes
it to the host, so there is no `curl` to run.

```sql
SELECT count(*) FROM raw.records WHERE source = 'gmail';
SELECT content_type, byte_length FROM raw.documents;

-- No filename, subject or address may appear here: this table is granted to dbt.
SELECT metadata FROM raw.documents LIMIT 5;
```

Run it a second time straight away. Every document should report `unchanged` and the lake
should gain no new version — that is the idempotency guard, and it is the one that silently
costs disk if it is wrong.

## 8. Check disconnecting really disconnects

Press **Disconnect**, then open <https://myaccount.google.com/permissions> as the connected
account. The grant should be gone there too, not only from our table. If the UI says it could
not tell Google, revoke it by hand there — the card says so for exactly this case.

## 9. A second mailbox, or a second Drive account

A tenant may connect several Gmail mailboxes and several Drive accounts at once. On the card,
**Add another account** starts a consent that shows Google's account chooser. The account
chosen there gets a connection of its own. Each account on the card has its own:

- status mark;
- scope;
- schedule;
- last run;
- **Run now**, **Change scope** and **Disconnect**.

Two Gmail accounts are not a subset of each other, so connect both rather than choosing one.
[ADR 0043](../adr/0043-a-second-mailbox-is-a-second-source.md) explains why each account is a
source of its own.

The first account of a kind keeps the source `gmail`, or `drive` for Drive. Every further one is
`gmail.<account key>`, twelve hex characters derived from Google's account id:

```sql
SELECT source, status, external_account_id FROM ops.connection
WHERE source = 'gmail' OR source LIKE 'gmail.%';
SELECT source, account_label FROM app.connection_detail
WHERE source = 'gmail' OR source LIKE 'gmail.%';
```

**A dbt model that filters `source = 'gmail'` sees only the first mailbox.** Filter
`source = 'gmail' OR source LIKE 'gmail.%'` instead, or select from the shipped macro.

The same letter often reaches both mailboxes, under unrelated Gmail ids, and
`{{ gmail_letters() }}` folds those copies into one row per letter. It keys on the RFC 5322
`Message-ID` header, and a letter without one stands alone. For each letter it also returns:

- which mailboxes held it, under which ids;
- whether the copies disagree on their headers.

```sql
select letter_key, copies, sources, headers_conflict
from {{ gmail_letters() }}
```

**Reconnect is pinned to its account.** Completing "Reconnect" on one mailbox while the browser
is signed in as another is refused. It is not silently switched to the other mailbox, which
would file that mailbox's mail under this one.

---

## When something is wrong

| Symptom                                                         | Cause                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The connect button does nothing                                 | `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID` is unset; the source falls back to the placeholder URL.                                                                                                                        |
| `redirect_uri_mismatch`                                         | `UNDERCROFT_PUBLIC_URL` is not the origin the browser uses. Google builds the redirect URI from it.                                                                                                                 |
| Returned to the schedule with `connect=failed&reason=not-admin` | The session is not an admin of that tenant. Starting a flow is not a standing authorisation; it is re-checked at the callback.                                                                                      |
| `reason=bad-state`                                              | The consent took longer than 15 minutes, or the link was opened twice. Both are refused identically by design.                                                                                                      |
| `reason=worker-refused`                                         | The worker is unreachable or `UNDERCROFT_TRIGGER_TOKEN` differs between the two services.                                                                                                                           |
| `reason=account-mismatch`                                       | A Reconnect was completed by a different Google account from the one that connection belongs to, or by an account already connected under another source. To connect that mailbox too, use **Add another account**. |
| `reason=account-unidentified`                                   | Google did not say which account consented, or the first account never recorded one. Reconnect the existing account first, then add the next.                                                                       |
| A run fails with "has no recorded scope"                        | Connected but nobody has chosen what to read. That is deliberate: an absent scope is never defaulted to the whole mailbox.                                                                                          |
| Gmail returns nothing with several labels chosen                | Should not happen — `labelIds` is AND, and the collector issues one query per label. If it recurs, that union is the first place to look.                                                                           |
