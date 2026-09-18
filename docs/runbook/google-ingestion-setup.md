# Setting up Gmail and Drive ingestion

Standing up the per-tenant Google consent from nothing, with a way to check each step
actually worked.

> **This is not sign-in.** Signing in asks Google for `openid email profile` and is set up in
> [sign-in-setup.md](./sign-in-setup.md). This asks for a customer's mailbox or documents, per
> tenant, and its credentials are sealed into `app.connection_secret` by the worker. They use
> **two different Google clients on purpose** — one client carrying both scope lists is one
> misconfiguration away from handing over a mailbox as a side effect of signing in. The
> reasoning is in [ADR 0014](../adr/0014-the-worker-seals-the-control-plane-consents.md).

---

## 0. Read this before you start: verification is the long pole

`gmail.readonly` is a Google **restricted** scope. Until the OAuth client is verified you are
capped at 100 test users behind an unverified-app interstitial, and restricted scopes
additionally require a **security assessment (CASA)** that is repeated every twelve months.
That is weeks of calendar time and a real invoice, and no amount of code changes it.

`drive.file` — which is what Drive uses here — is **not** restricted. It needs only basic
verification, no CASA, and no annual renewal. That is why Drive is scoped through Google's
Picker rather than by a folder listing of our own.

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
| Drive  | `https://www.googleapis.com/auth/drive.file`     | non-sensitive                                            |
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

```sh
curl -sS -X POST localhost:18081/v1/runs/ingest \
  -H "Authorization: Bearer $UNDERCROFT_TRIGGER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"source":"gmail","tenantId":"CASE-0042"}'
```

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

---

## When something is wrong

| Symptom                                                         | Cause                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The connect button does nothing                                 | `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID` is unset; the source falls back to the placeholder URL.                                              |
| `redirect_uri_mismatch`                                         | `UNDERCROFT_PUBLIC_URL` is not the origin the browser uses. Google builds the redirect URI from it.                                       |
| Returned to the schedule with `connect=failed&reason=not-admin` | The session is not an admin of that tenant. Starting a flow is not a standing authorisation; it is re-checked at the callback.            |
| `reason=bad-state`                                              | The consent took longer than 15 minutes, or the link was opened twice. Both are refused identically by design.                            |
| `reason=worker-refused`                                         | The worker is unreachable or `UNDERCROFT_TRIGGER_TOKEN` differs between the two services.                                                 |
| A run fails with "has no recorded scope"                        | Connected but nobody has chosen what to read. That is deliberate: an absent scope is never defaulted to the whole mailbox.                |
| Gmail returns nothing with several labels chosen                | Should not happen — `labelIds` is AND, and the collector issues one query per label. If it recurs, that union is the first place to look. |
