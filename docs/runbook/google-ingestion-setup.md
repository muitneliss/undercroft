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
grant. Its card reads "Reconnect required", and each of its runs fails with a reason that says to
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

Under **Authorized JavaScript origins**, add each origin the browser uses
(`http://localhost:13000`, `http://localhost:5173` for the Vite dev server, and
`https://your-domain`). The Drive Picker asks Google for a browser token with this same
client id, and Google issues one only to a registered origin; without it the Picker fails
with `origin_mismatch`.

**Add no Gmail or Drive scope to the sign-in client, and no identity-only client here.**

## 2. Enable the APIs

**APIs & Services** → **Library** → enable **Gmail API**, **Google Drive API**, and
**Google Picker API**.

## 3. Add the scopes to the consent screen

**OAuth consent screen** → **Data access**:

| Source                     | Scope                                            | Classification                                                  |
| -------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Gmail                      | `https://www.googleapis.com/auth/gmail.readonly` | restricted — CASA                                               |
| Drive                      | `https://www.googleapis.com/auth/drive.readonly` | restricted — CASA (the same assessment as Gmail's)              |
| both                       | `openid`, `email`                                | identity, so the callback learns which account consented        |
| Drive Picker, browser only | `https://www.googleapis.com/auth/drive.file`     | non-sensitive; only shows the Picker and returns the chosen ids |

**OAuth consent screen** → **Branding**, which Google's verification reviews against the scopes
above. Every link must sit on an authorised domain and open without signing in:

| Field                        | Value on the hosted service                        |
| ---------------------------- | -------------------------------------------------- |
| App logo                     | `apps/ui/public/apple-touch-icon.png` (square PNG) |
| Application home page        | `https://blog.undercroft.lowbit.link/en/app/`      |
| Application privacy policy   | `https://blog.undercroft.lowbit.link/en/privacy/`  |
| Application terms of service | `https://blog.undercroft.lowbit.link/en/terms/`    |
| Authorised domains           | `lowbit.link`                                      |

The home page is the blog's app page, not the product's root and not the blog's index. The
product's root is a JavaScript page that opens in Vietnamese and leads with signing in, and a
reviewer reported it as "behind a login page" that "does not explain the purpose of your app".
The blog's index is a list of articles. The app page is static English HTML that says what the
app does, what each Google permission is used for, and that Google data never trains a model
or makes an image, and it links the privacy policy and terms. The product's public home links
the same three pages from its "Your Google data, read-only" section.

All three live in the blog's `src/content/service/`. The privacy policy carries Google's Limited
Use statement and names every provider that can receive Google user data. The app page and the
privacy policy both name every scope in step 3. Change them in the same change that adds a
scope or a provider, then publish with `task cd:blog`.

**Verify the domain before you submit.** Google refuses a home page on a domain the project's
owner has not proved is theirs ("is not registered to you"). In
[Google Search Console](https://search.google.com/search-console), add a **Domain** property for
`lowbit.link`. It covers every subdomain. Google then shows a `google-site-verification=…` TXT
record: add it at the root of the `lowbit.link` zone in Cloudflare and press **Verify**. Use the
Google account that owns the Cloud project. Wait 24 hours after verifying before you ask for
review again.

**Google Auth Platform** → **Audience** → **Publish app**, so the publishing status reads
**In production**. While it reads **Testing**, Google lets every refresh token live **seven
days** from consent. After that every Gmail and Drive run is refused, the card reads "Cần cấp lại
quyền" (needs reconnecting), and a reconnect only buys another week. Publishing does not need
verification to have finished: an unverified app in production keeps the 100-user cap and
the interstitial from step 0, and its refresh tokens stop expiring. A token issued while the
project was in Testing keeps its seven days, so reconnect each Google connection once after
publishing.

You can tell when a deployment is still in Testing. Google says when each refresh token dies, the
platform records that as the grant's end, and every administrator of the customer gets the
"access is about to expire" email straight after each consent
([ADR 0144](../adr/0144-a-refresh-token-s-stated-end-is-the-grant-s-end.md)).

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

The worker also reads `UNDERCROFT_GOOGLE_MIN_INTERVAL_MS`, the milliseconds between two Gmail or
Drive requests. Leave it empty to pace three a second, inside Google's enforced rate per user;
set it only for a project whose quota differs. A value that is not a positive whole number
fails the run.

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

Press **Run now** on the source's card (whoever holds `sources:manage`, an admin, sees it). The card shows _Running_ and
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

Run it a second time straight away. It should read no message again: the Journal says every
message is already held and not read, and the lake gains no new version. That is the guard that
silently costs hours of reading, and disk, if it is wrong.

Add a file type on **Change what syncs** and run again. Only held messages carrying an
attachment of that type are read again, and the Journal says how many and how many attachments
landed. On a mailbox that ran before ADR 0076, the first run after the upgrade reads every held
message once, about three a second. [File formats](../reference/file-formats.md#when-the-choice-changes)
has the rules.

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
- **Run now**, **Change what syncs** and **Disconnect**.

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

| Symptom                                                                                                                                            | Cause                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connect says the deployment is not set up to connect Google accounts                                                                               | `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID` / `_SECRET` or `UNDERCROFT_PUBLIC_URL` is unset on the control plane.                                                                                                                                 |
| `redirect_uri_mismatch`                                                                                                                            | `UNDERCROFT_PUBLIC_URL` is not the origin the browser uses. Google builds the redirect URI from it.                                                                                                                                        |
| Returned to the tenant's Sources page with `connect=failed&reason=not-permitted`                                                                   | The session does not hold `sources:manage` in that tenant (an admin does). Starting a flow is not a standing authorisation; it is re-checked at the callback.                                                                              |
| `reason=declined`                                                                                                                                  | Cancelled at Google's screen. Nothing was granted.                                                                                                                                                                                         |
| `reason=scope-declined`                                                                                                                            | A permission was unticked on Google's screen. Connect again and leave every box ticked.                                                                                                                                                    |
| `reason=bad-state`                                                                                                                                 | The consent took longer than 15 minutes, or the link was opened twice. Both are refused identically by design.                                                                                                                             |
| `reason=worker-refused`                                                                                                                            | The worker is unreachable or `UNDERCROFT_TRIGGER_TOKEN` differs between the two services.                                                                                                                                                  |
| `reason=account-mismatch`                                                                                                                          | A Reconnect was completed by a different Google account from the one that connection belongs to, or by an account already connected under another source. To connect that mailbox too, use **Add another account**.                        |
| `reason=account-unidentified`                                                                                                                      | Google did not say which account consented, or the first account never recorded one. Reconnect the existing account first, then add the next.                                                                                              |
| Every Gmail and Drive card needs reconnecting about a week after its last consent, and runs fail with "was refused by the provider when refreshed" | The consent screen is still in **Testing**, whose refresh tokens Google ends after seven days. Publish it (step 3), then reconnect each connection once. The "access is about to expire" email straight after a consent is the same cause. |
| A run fails with "has no recorded scope"                                                                                                           | Connected but nobody has chosen what to read. That is deliberate: an absent scope is never defaulted to the whole mailbox.                                                                                                                 |
| Gmail returns nothing with several labels chosen                                                                                                   | Should not happen — `labelIds` is AND, and the collector issues one query per label. If it recurs, that union is the first place to look.                                                                                                  |
