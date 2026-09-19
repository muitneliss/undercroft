# Setting up Xero ingestion

Standing up the per-tenant Xero consent from nothing, with a way to check each step actually
worked.

> **This is not sign-in.** Signing in is Better Auth's and is set up in
> [sign-in-setup.md](./sign-in-setup.md). This asks for a customer's accounting data, per
> tenant, and its credential is sealed into `app.connection_secret` by the worker. The
> reasoning is in [ADR 0016](../adr/0016-the-worker-seals-the-control-plane-consents.md).

## 0. What is different about Xero

Three things, each of which the code handles and each of which you will meet while testing:

- **Xero rotates the refresh token.** Every refresh issues a new pair and kills the one just
  spent. The worker writes the new pair back under a row lock before it uses the access token,
  and a refresh that comes back without a new refresh token is refused rather than stored.
- **One consent can see several organisations.** An accountant's login sees every client's
  books. After consent the administrator is asked which organisation to read; its id is sent as
  the `xero-tenant-id` header on every request. A run without one is refused before its first
  request.
- **The grant lapses sixty days after its last use.** Every successful refresh moves that date
  forward; runs stopping is what lets it arrive. The platform warns the customer's
  administrators a week before, and the card says "reconnect" once it has passed.

The whole surface is gated on `UNDERCROFT_XERO_CLIENT_ID`. With it unset, Xero reads "not
connected" and its button says the deployment is not set up for it.

## 1. Create the Xero app

At [developer.xero.com](https://developer.xero.com/app/manage) create a **Web app** (OAuth 2.0,
authorization code). Register exactly one redirect URI:

```
<UNDERCROFT_PUBLIC_URL>/oauth/xero/callback
```

`UNDERCROFT_PUBLIC_URL` is the origin the browser uses. Xero matches the URI exactly, path
included. The Google consent has its own callback at `/oauth/google/callback`; the two are
registered in two consoles and never share one.

Copy the client id and generate a client secret.

## 2. Configure both services

Set the same two values on the **control plane** (which runs the consent) and the **worker**
(which refreshes and revokes):

```
UNDERCROFT_XERO_CLIENT_ID=
UNDERCROFT_XERO_CLIENT_SECRET=
```

In production these go into Dokploy's environment by hand — `preflight` asserts the panel's
configuration and CI never writes it. Both compose files already pass them through.

## 3. Check the scopes agree

The consent asks for the scopes `specs/connectors/xero.yaml` declares under `auth.scopes`,
kept in step by hand in `apps/control-plane/src/services/oauthProviders.ts`. A consent narrower
than the spec fails every run with a 403 far from here. If you add an entity that needs a new
scope, add it in both places.

## 4. Connect a customer, and verify each step

1. Open the customer's Sources leaf as an admin and press **Connect Xero**. The browser goes to
   `login.xero.com`; the `redirect_uri` in the address bar must be the one you registered.
2. Allow. The browser lands on `/tenants/<id>/connect/xero/scope`, which lists the
   organisations the consent can see. Choose one and the entities to read.
3. The card now names the organisation and reads **connected**. `ops.connection` holds the
   organisation id in `external_account_id`; the name is in `app.connection_detail`, where BI
   cannot read it.
4. Press **Run now**. The journal shows the run and its counts per entity. A `401` after zero
   records is a scope problem (step 3); a `403` naming the organisation is the wrong
   organisation chosen.
5. Disconnect. Xero is told to revoke the refresh token; the card says whether it could be.

## 5. What each failure looks like

| Symptom                                          | Cause                                        | Fix                             |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------- |
| Xero shows "invalid redirect_uri"                | The registered URI differs from the one sent | Register the exact callback URL |
| Connect goes back with `reason=not-configured`   | The client is unset on the control plane     | Set both variables, redeploy    |
| The scope page lists no organisation             | The Xero user has access to none             | Consent from a user who does    |
| Every run fails after 0 records with 401         | A refresh failed, or the grant lapsed        | Reconnect; check the worker log |
| Runs fail with "needs the provider's account id" | No organisation was chosen                   | Choose one on the scope page    |
