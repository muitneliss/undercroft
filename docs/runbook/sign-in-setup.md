# Setting up sign-in

A step-by-step for standing up sign-in from nothing, with a way to check each step actually
worked. Sign-in is **invite-only**: an address gets in only if it has a live invitation or an
existing account. Two ways in, and you can enable either or both:

- **Google** — needs an OAuth client.
- **A one-time code by email** — needs a mail API key.

The decisions behind all this are in [ADR 0010](../adr/0010-invite-only-sign-in-with-better-auth.md);
the production-specific parts are in [deployment.md](./deployment.md). This page is the
walkthrough.

> **Gmail and Drive ingestion are not this.** Signing in asks for identity scopes only
> (`openid email profile`). Pulling mail or files is a separate, per-tenant consent, through a
> **separate Google client**, whose credentials are sealed in `app.connection_secret` by the
> worker. Do not add Gmail or Drive scopes to the login client — that would hand over a
> mailbox as a side effect of signing in. Setting that up is
> [google-ingestion-setup.md](./google-ingestion-setup.md).

---

## 0. What you need

- Docker (for Postgres, or the whole stack)
- A Google account that can create an OAuth client in [Google Cloud Console](https://console.cloud.google.com)
- Optional, for code-by-email: an account with a mail API provider ([Resend](https://resend.com) works out of the box)

Pick a path:

|            | Path A — full stack in Docker          | Path B — local dev loop                  |
| ---------- | -------------------------------------- | ---------------------------------------- |
| You browse | `http://localhost:13000`               | `http://localhost:5173` (Vite)           |
| Good for   | trying it, or anything production-like | iterating on the UI                      |
| Runs       | everything in compose                  | Postgres in compose, the rest with `bun` |

The steps are the same either way; only `UNDERCROFT_PUBLIC_URL` and how you start things
differ. **`UNDERCROFT_PUBLIC_URL` must be the origin your browser uses**, because Google's
`redirect_uri` is built from it.

---

## 1. Make the session secret

This signs session cookies. Changing it later ends every signed-in session at once — which is
also how you evict everybody in a hurry.

```sh
openssl rand -base64 32
```

## 2. Create the Google OAuth client

Skip this if you only want code-by-email.

1. Google Cloud Console → **APIs & Services** → **Credentials**
2. **Create credentials** → **OAuth client ID** → Application type **Web application**
3. Under **Authorized redirect URIs**, add one line per origin you will sign in from. The
   path is Better Auth's and is not negotiable:

   ```
   http://localhost:13000/api/auth/callback/google     ← Path A
   http://localhost:5173/api/auth/callback/google      ← Path B
   https://your-domain/api/auth/callback/google        ← production
   ```

4. Leave scopes at the default `openid email profile`. **Add nothing else.**
5. Copy the **Client ID** and **Client secret**.

If the consent screen asks: **Internal** if your Workspace allows it, otherwise **External /
Testing** with your invitees added as test users.

## 3. Get a mail API key

Skip this if you only want Google — but note that invitation emails will not send either, so
you will have to tell people to sign in yourself. The page tells you when that happens.

With Resend: create an API key, and use `onboarding@resend.dev` as the from-address until you
have verified a domain of your own.

## 4. Write the environment file

```sh
cd deploy/compose
cp .env.example .env
```

Then fill in, at minimum:

```sh
UNDERCROFT_PG_PASSWORD=some-local-password
UNDERCROFT_SECRET_KEY=<openssl rand -base64 32>
UNDERCROFT_SESSION_SECRET=<the value from step 1>
UNDERCROFT_TRIGGER_TOKEN=any-local-value

# Path A. For Path B use http://localhost:5173
UNDERCROFT_PUBLIC_URL=http://localhost:13000

UNDERCROFT_GOOGLE_CLIENT_ID=<from step 2>
UNDERCROFT_GOOGLE_CLIENT_SECRET=<from step 2>

UNDERCROFT_EMAIL_API_KEY=<from step 3>
UNDERCROFT_EMAIL_FROM=Undercroft <onboarding@resend.dev>
```

`.env` is gitignored. Do not commit it.

## 5. Start Postgres and apply the schema

```sh
# Path A: everything
docker compose -f deploy/compose/docker-compose.yml up -d

# Path B: just the database
docker compose -f deploy/compose/docker-compose.yml up -d postgres
```

Then, from the repo root:

```sh
bun install
UNDERCROFT_POSTGRES_DSN='postgres://undercroft:<UNDERCROFT_PG_PASSWORD>@localhost:15432/undercroft' \
  bun run migrate
```

**Check it worked.** You want `060_auth.sql` in the applied or skipped list:

```
apply  001_roles.sql
apply  020_control_plane.sql
...
apply  060_auth.sql
applied 6 migration(s)
```

Re-running prints `already up to date`.

On the **server** you never run this by hand: the `db-migrate` compose service applies the
schema on every deploy, and both the control plane and the worker wait for it to finish. With
Path A that service runs here too; the command above is for Path B, or for a database you
restored yourself.

If the schema is behind, sign-in does not degrade — it **stops**. Better Auth answers 500 to
every `/api/auth/*` request and logs `Database schema mismatch` naming the missing tables,
while still logging `sign_in_configured` at boot. So "configured" in the log does not mean
"working"; look for the mismatch line too.

## 6. Start the control plane

**Path A** — already running. Skip to step 7.

**Path B**, in two terminals from the repo root:

```sh
# terminal 1 — the API
UNDERCROFT_POSTGRES_DSN='postgres://undercroft:<password>@localhost:15432/undercroft' \
UNDERCROFT_SESSION_SECRET='<step 1>' \
UNDERCROFT_PUBLIC_URL='http://localhost:5173' \
UNDERCROFT_GOOGLE_CLIENT_ID='<step 2>' \
UNDERCROFT_GOOGLE_CLIENT_SECRET='<step 2>' \
UNDERCROFT_EMAIL_API_KEY='<step 3>' \
UNDERCROFT_EMAIL_FROM='Undercroft <onboarding@resend.dev>' \
  bun run apps/control-plane/src/main.ts

# terminal 2 — the UI
cd apps/ui && bun run dev
```

**Check it worked.** The boot log should say sign-in is configured:

```json
{ "event": "sign_in_configured", "methods": "google,email-otp" }
```

If it says `sign_in_unconfigured` instead, it names exactly which values are missing — the
process deliberately starts with no way in rather than offering a button that fails on click.

## 7. Bootstrap the first admin

Invitations are issued from the **People** page, but nobody is signed in yet and there is no
one to invite you. Two ways out of that, and the first needs no shell.

### The way that needs no shell: `UNDERCROFT_SUPERADMINS`

Name yourself in the environment, with **your own real address** — the one on the Google
account you will click through with:

```sh
UNDERCROFT_SUPERADMINS=you@yourdomain.com
```

Several are comma-separated, and naming more than one is the point: a single person on
holiday should not be able to lock everybody out.

```sh
UNDERCROFT_SUPERADMINS=you@yourdomain.com,colleague@yourdomain.com
```

Restart the control plane — on the server, set it in Dokploy's environment and redeploy. The
boot log counts them:

```json
{ "event": "superadmins_configured", "count": 2 }
```

If it says `superadmins_none`, the variable did not reach the process. If it says
`superadmins_rejected`, it prints back the entries it would not read — almost always a
semicolon or a space where a comma belongs. The addresses themselves are never logged.

Then sign in (step 8). You land on an empty **Customers** page with an **Add a customer**
form that only a superadmin sees; create `CASE-0001` there, then invite everyone else from
**People** as normal.

Three things worth knowing:

- **The variable is the authority, not a seed.** Nothing in the database records who is a
  superadmin. Remove an address and redeploy, and it is withdrawn at the next request; add
  one and it is granted. That is also the recovery path if every tenant admin leaves.
- **It grants authority, never identity.** You still prove you control the address, through
  Google or a one-time code, exactly like everyone else.
- **A superadmin administers every customer**, present and future. It is not the top of the
  `viewer`/`member`/`admin` ladder, it is beside it. ADR 0013.

### The way that needs no deploy: `bun run invite`

Still the right tool for inviting somebody to **one** customer, and the one to use if you
would rather nobody held platform authority. One command, once:

```sh
UNDERCROFT_POSTGRES_DSN='postgres://undercroft:<password>@localhost:15432/undercroft' \
  bun run invite -- you@yourdomain.com --tenant CASE-0001 --role admin --create-tenant
```

```
created tenant CASE-0001
invited you@yourdomain.com to CASE-0001 as admin
NOT emailed (mail is not configured) — tell them to sign in with that exact address
```

`--create-tenant` is opt-in so a typo cannot invent a customer; leave it off for everyone
after the first. With the mail variables set it sends the same message the People page sends
and prints `an email has been sent` instead.

The invitation email is written in Vietnamese unless you ask otherwise — add `--lang en` for
an English one. There is no browser to negotiate with here, and this is the one invitation on
a fresh deployment that nobody can send from the People page, so the flag is how that first
person gets an email in a language somebody chose. `--lang` refuses anything but `vi` or `en`
rather than quietly falling back. See ADR 0012.

This writes an ordinary invitation — it does **not** bypass the gate. Whoever holds the
address still has to prove it, through Google or a one-time code. No token is issued: those
two already prove control of the mailbox, which is all a token would have proved.

On the server, run it inside the control-plane container, which already has the DSN:

```sh
docker exec -it undercroft-<stack>-control-plane-1 bun run invite -- \
  you@yourdomain.com --tenant CASE-0001 --role admin --create-tenant
```

## 8. Sign in

Open `http://localhost:13000` (Path A) or `http://localhost:5173` (Path B).

**With Google** — click _Continue with Google_ and pick the invited account.

**With a code** — type the invited address, click _Email me a code_, then enter the six digits.

**Check it worked.** You land on the customers list with `CASE-0001` in it, and your address
in the running head. In the database:

```sql
SELECT u.email, m.tenant_id, m.role
FROM app.app_user u JOIN app.tenant_member m ON m.user_id = u.id;
-- you@yourdomain.com | CASE-0001 | admin

SELECT email, accepted_at FROM app.invitation;
-- accepted_at is now set: the invitation was consumed
```

## 9. Invite everyone else — no more SQL

Open the tenant → **People**. Enter an address, pick a role, send.

| Role     | Can                                                |
| -------- | -------------------------------------------------- |
| `viewer` | look                                               |
| `member` | look, and trigger a sync                           |
| `admin`  | all of it, plus connect accounts and invite people |

The page tells you whether the invitation was actually emailed. If mail is not configured it
still works — you just have to tell the person yourself. They must sign in with **exactly**
that address.

You can withdraw an invitation that has not been accepted yet. Removing someone who already
signed in means removing their membership, which is a different thing and not wired to a
button yet.

---

## When it does not work

| What you see                             | What it means                                                                   | Fix                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch` from Google      | `UNDERCROFT_PUBLIC_URL` does not match a registered URI, exactly, path included | Re-check step 2; `http` vs `https` and the port both count                                                                    |
| Boot log says `sign_in_unconfigured`     | A required value is unset; it names which                                       | Step 4                                                                                                                        |
| `Database schema mismatch` / 500 on auth | Migrations not applied                                                          | Step 5                                                                                                                        |
| "That address has not been invited"      | No live invitation for that exact address                                       | Step 7, and check for a typo or a different case                                                                              |
| No code ever arrives                     | Either mail is not configured, or the address is not invited                    | Check the boot log; the server will not say which, on purpose — telling you would let anyone test which addresses have access |
| Signed in, but no customers listed       | You have a session but no membership                                            | Check `app.tenant_member`; the invitation may have been for another tenant                                                    |
| `permission denied for table auth_user`  | The auth tables exist without grants                                            | Re-run step 5; `060_auth.sql` carries its own grants                                                                          |
| Sign-in worked, then a blank page        | Stale bundle from before the router fix                                         | Hard-reload, or rebuild the UI                                                                                                |

Two by-design behaviours that look like bugs:

- **Asking for a code for an uninvited address returns success and sends nothing.** Saying
  "not invited" would turn the form into a way to test which addresses have access.
- **Signing out leaves a cookie in the browser.** It resolves to no session and is overwritten
  at the next sign-in. The session row is deleted server-side, which is what actually matters.
