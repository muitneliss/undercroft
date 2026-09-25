# Deployment runbook

Undercroft runs on the Dokploy instance at `lowbit.link` as a single compose stack that
clones this repository's `main` on every deploy (ADR 0049).

**Live surface:**

- https://undercroft.lowbit.link — the control plane (`control-plane`). The Reports
  division inside it is the BI; Metabase is gone (ADR 0020).

Everything else talks over the compose network and publishes nothing.

## What is deployed

| Service                      | Reachable from       | Notes                                                                  |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `control-plane`              | the internet, HTTPS  | tRPC + sign-in + SPA. **Configure sign-in — see the warning below.**   |
| `worker`                     | compose network only | Ingestion, dbt per tenant, the BI query runner; HTTP verbs on :8081    |
| `minio`                      | compose network only | Raw lake, on the `pgsty/minio` community build (ADR 0050)              |
| `minio-init`                 | one-shot, exits 0    | Creates the lake's bucket                                              |
| `postgres`                   | compose network only | Curated + control-plane schema                                         |
| `kestra` + `kestra-postgres` | compose network only | Scheduling: `ingest_due` every 15 minutes, `extract_due` hourly        |
| `kestra-init`                | one-shot, exits 0    | Hands Kestra's volumes to uid 1000; without it Kestra crash-loops      |
| `db-migrate`                 | one-shot, exits 0    | Applies `packages/db/sql`, sets the two platform roles' passwords      |
| `kestra-flows`               | one-shot, exits 0    | Delivers `flows/` to Kestra from the control-plane image, every deploy |

> **Sign-in must be configured, or the control plane has no way in.** Authentication is
> wired (invite-only, Google or an emailed code — ADR 0010), but it is assembled only when
> its environment is complete. With any of `UNDERCROFT_PUBLIC_URL`,
> `UNDERCROFT_SESSION_SECRET` or the email settings unset, the process starts with no
> `/api/auth/*` route at all and every `/trpc/*` call is anonymous — which is the state ADR
> 0008's risk note described. Check for `sign_in_unconfigured` in the boot log, and see
> [Sign-in](#sign-in) below.

## The two compose files

`deploy/compose/docker-compose.yml` is for development (it `build:`s the images and binds
ports to localhost). `docker-compose.server.yml` is the file Dokploy deploys, cloned from
`main` each time; the panel holds no copy of it. It differs in three ways, each a failure that
happened once:

1. **Published images**, `ghcr.io/muitneliss/undercroft-{worker,control-plane}:${IMAGE_TAG:-latest}`.
   The host's checkout is `main` at deploy time, not the release, so a `build:` there would
   ship code no release published and no `verify` could prove.
2. **No host ports.** Only the control plane is reachable, through Dokploy's proxy.
3. **A unique network alias per service** (`undercroft-postgres`, `undercroft-minio`, …), and
   every reference uses it. A service with a domain is attached to the shared
   `dokploy-network`, where `postgres` and `minio` are names other projects use too — on the
   old stack, the Metabase it then carried authenticated against another project's database,
   stopped only by a password mismatch.

Keep the two files in step. A change to the development file that is not mirrored to the
server file will not survive a deploy.

## How a deploy happens

**Automatically, on a release.** Merge the release-please PR → `version` bumps, a tag is cut
→ the images build → `deploy.yml` runs `task cd:preflight → cd:deploy → cd:verify →
cd:smoke` (each wrapping `scripts/dokploy.ts`). See ADR 0008 and ADR 0023. Nothing else
deploys; a plain push to `main` ships nothing.

release-please opens that PR as a **GitHub App**, not as `github-actions[bot]`. Since June
2026 GitHub holds every workflow run on a PR the default token authored behind "requires
approval from a maintainer", so the release PR would arrive with no CI until someone clicked
— and a release merged on an unapproved PR is a release merged on no evidence. Two settings
feed it, and a rotation that misses either fails the `release` workflow at its first step:

| Where                          | Name                         | Value                                  |
| ------------------------------ | ---------------------------- | -------------------------------------- |
| Settings → Actions → Variables | `RELEASE_PLEASE_CLIENT_ID`   | the App's client id (`Iv23…`)          |
| Settings → Actions → Secrets   | `RELEASE_PLEASE_PRIVATE_KEY` | the App's generated `.pem`, whole file |

The App needs **Contents: read & write** and **Pull requests: read & write** on this
repository and nothing else, and it must be installed on it. The key and the client id must
come from the same App: a key from any other App fails with "A JSON web token could not be
decoded", which says nothing about which of the two is wrong. It is an App rather than a
personal token because a PAT expires and makes every release read as authored by whoever
minted it.

**By hand**, using the same client, wrapped in Task (needs the three env vars — never write
them to a file):

```bash
export DOKPLOY_API_ENDPOINT=https://lowbit.link/api
export DOKPLOY_API_KEY=...           # from Dokploy → Settings → API
export DOKPLOY_COMPOSE_ID=...        # the undercroft compose

task cd:preflight              # panel clones main's compose, main carries this checkout's file
task cd:deploy TAG=v1.2.3      # trigger, then wait for the record THIS run created
task cd:verify TAG=v1.2.3      # every released container runs that tag's digest
task cd:smoke                  # defaults to https://undercroft.lowbit.link/api/health
```

Or all four in sequence, the same way `deploy.yml` does: `task cd:release TAG=v1.2.3`.

The API is the only channel for a change. SSH is for reading state, never making one: a
direct edit on the host is drift the next deploy silently reverts.

### What `preflight` proves

Four things, before anything is queued:

1. **The panel clones the file rather than holding a copy.** Its compose source is `git`,
   `https://github.com/muitneliss/undercroft.git` at `main`, compose path
   `deploy/compose/docker-compose.server.yml`, with **auto deploy off** — on, it would roll
   out every push to `main` while images change only on a release.
2. **`main` carries the same file as this checkout.** The host clones `main`'s head at deploy
   time, not the release's commit. A change to the file merged while the release's images
   were building would otherwise ship beside images that predate it; `preflight` refuses,
   and the next release carries the change with its own images. Line endings and trailing
   blank lines are forgiven, nothing else is.
3. **The file names published images.** At least one service runs a
   `ghcr.io/muitneliss/undercroft-*` image; the host deploys what a release published, and
   never builds.
4. **The stored command** carries `--env-file deploy/compose/.env`,
   `-f deploy/compose/docker-compose.server.yml`, `--pull always`, `--wait`, `--wait-timeout`
   and `--remove-orphans`. Dokploy runs it from the clone's root and writes `.env` beside the
   compose file, which is why both paths are the file's own.

The panel used to hold a pasted copy, and the copy drifted: once until it ran a service this
repo had deleted (Metabase, ADR 0020) and three releases failed at `--wait`, and again when a
merged change to the file was never pasted and v1.26.0 stopped at `preflight`. There is no
copy now, so there is nothing to push after changing the file — merge it, and the next
release runs it.

These settings are the panel's, and CI never writes them (ADR 0008). A refusal is repaired in
the panel or with `compose.update`, by a person, sending only the fields above: its `env`
field replaces the whole environment blob. A variable a newer file needs must be in the
panel's environment _before_ the release that carries it, or the deploy stops at
`set in .env`.

### What `verify` proves

It asks the host for the config digest each released container is actually running, and
compares it to what ghcr serves — because Dokploy reports `done` for a deploy that changed
nothing, and every smoke probe passes against the old images.

The tag argument is which ghcr manifest to compare against. The **host** pulls `latest` (the
panel's `IMAGE_TAG`); passing `v1.2.3` makes the other side of the comparison that release's
immutable manifest, so a pass means "the host runs this release" rather than "a moving
pointer equals itself". A release publishes both tags to one digest, so they agree unless
something is wrong. With no release being rolled out, pass `TAG=latest`; the task
requires a tag.

Two services need different questions, and `verify` reads which is which from the compose
file's own `condition: service_completed_successfully` declarations rather than from a list
it keeps: a long-running service must be `running`, while a one-shot job (`db-migrate`,
`kestra-flows`) must have **exited 0**. Both still have their digest checked — a migration
that exited 0 on last release's image is still the wrong thing having run.

### A deploy during a run

Recreating the worker sends it SIGTERM. It tells every ingest in flight to stop at the next
safe point, waits up to 45 seconds for them to settle, and exits; the compose file gives it
`stop_grace_period: 60s` before Docker sends SIGKILL (ADR 0051). A run stopped this way is
`failed` in the journal with the message _the worker was shut down while this run was in
progress…_, and its counts are what it really landed. Nothing needs doing: the next scheduled
run, or **Run now**, carries on from there and does not land anything twice.

A Google ingest reaches a safe point after every message or Drive file, so it usually stops
in seconds. A run the worker could not stop in time — a long Gmail or Drive listing, a
download backing off on a rate limit, a dbt build — is closed by the stopping worker just
before it exits, with _the worker was shut down (a deploy or a restart) before this run
reached a point where it could stop safely…_ (ADR 0056). Its log line `stopped` says
`drained: false`, and `runs_cut_off` names the runs.

Only a run the worker lost with no warning — an OOM kill, a SIGKILL, a crash — is closed at the
next boot, with _the worker stopped abruptly…_, logged as `runs_abandoned`. So that message
after a deploy is worth a look at the kernel log and `docker inspect`'s `OOMKilled`, where the
cut-off message is not. Either way the counts read zero because the process could not write
them, not because the run landed nothing, and the next run is the same safe retry: it skips
what the stopped run kept.

## Notifications

The team's Lark group receives a card for each of these, posted by `scripts/notify.ts`
through `task notify:*`:

| Card                                               | Posted by                            |
| -------------------------------------------------- | ------------------------------------ |
| a deploy's result, the step that stopped it, links | `deploy.yml`, job `notify`           |
| a release that failed before its deploy started    | `release.yml`, job `notify`          |
| an issue opened, closed or reopened                | `notify.yml` (`issues`)              |
| a pull request opened, merged, closed or reopened  | `notify.yml` (`pull_request_target`) |
| a failed `ci` run on a push to `main`              | `notify.yml` (`workflow_run`)        |

A failed deploy posts once, from `deploy.yml`, which is why `release.yml`'s notice leaves the
deploy job out of its `needs`. A card that cannot be posted turns its own `notify` job red and
never changes the result of the deploy or the release it reports on.

| Where                        | Name                  | Value                                                        |
| ---------------------------- | --------------------- | ------------------------------------------------------------ |
| Settings → Actions → Secrets | `LARK_WEBHOOK_URL`    | the custom bot's webhook URL — required                      |
| Settings → Actions → Secrets | `LARK_WEBHOOK_SECRET` | the bot's signing secret — set it when signing is on in Lark |

**The webhook URL is the credential**: anyone holding it can post into the group. It lives
only in the secret and is never printed. For a second factor, turn on **Signature
verification** in the bot's security settings in Lark and store the secret it shows as
`LARK_WEBHOOK_SECRET`, both at once — Lark refuses an unsigned card once signing is on, and
the notify job reports that refusal (`code 19021`) instead of calling it sent. If you add
**Custom keywords** instead, every card title must contain one of them.

To rotate the webhook, replace the secret, then prove it from a terminal. The URL is read
from your shell and never goes into a file:

```bash
gh secret set LARK_WEBHOOK_URL          # paste the new URL at the prompt
LARK_WEBHOOK_URL=... task notify:test   # posts a test card, exits non-zero if Lark refuses it
```

A card renders an issue or pull-request body as Lark markdown (headings as bold lines,
lists, links, GitHub emoji shortcodes) and colours a pull request's `+`/`−` line counts.
Every tag in quoted text is escaped, never obeyed, because an issue titled
`<at id=all></at>` would otherwise mention the whole group; titles stay plain text.
`notify.yml` runs on `pull_request_target` so that a fork's pull request can use the
secret too. That is safe only because it checks out the default branch and never runs the
pull request's code, so never add a checkout of the pull request's head to that file.

### Sync status

The control plane posts to a Lark group too, from its alert tick
(`apps/control-plane/src/services/alerts.ts`), once a minute:

| Card                                               | When                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| red: a sync or model build failed, with its reason | the same failure a tenant's admins are emailed about; a repeat within a day is held likewise |
| green: it is working again, and since when it was  | the first successful run after a failure one of these cards (or an email) announced          |

Cards are written in Vietnamese, the platform's language, and link to the run in the journal.
The ledger's `ops.run.notice` claims each one, so a card goes out at most once however many
replicas tick. A card Lark refuses is logged as `alert_post_failed` and not retried.

| Where               | Name                             | Value                                                        |
| ------------------- | -------------------------------- | ------------------------------------------------------------ |
| Dokploy environment | `UNDERCROFT_LARK_WEBHOOK_URL`    | the custom bot's webhook URL — unset means email only        |
| Dokploy environment | `UNDERCROFT_LARK_WEBHOOK_SECRET` | the bot's signing secret — set it when signing is on in Lark |

These are not CI's `LARK_WEBHOOK_URL`: that one is a GitHub secret and this one is the
deployment's environment, so the two may name the same group or different ones. Set them in
Dokploy by hand and redeploy; the control plane's boot line `alerts_configured` then reports
`lark: true`. The tick also needs `UNDERCROFT_PUBLIC_URL` for its links, and with Lark set it
runs even where email is not configured.

## Environment variables

**Dokploy does not inject its variables into containers.** A variable saved in Dokploy is
only the _source_ of a value; it reaches a container only if that service's `environment:`
block names it. An unmapped one arrives as an empty string and fails far from the cause.

Production values live in Dokploy's environment and in a local gitignored file; they are
never committed. `deploy/compose/.env.example` lists the names. The `:?set in .env` variables
have no default and hard-fail the stack if unset:
`UNDERCROFT_S3_ACCESS_KEY`, `UNDERCROFT_S3_SECRET_KEY`, `UNDERCROFT_PG_PASSWORD`,
`UNDERCROFT_APP_PG_PASSWORD`, `UNDERCROFT_WORKER_PG_PASSWORD`, `UNDERCROFT_KESTRA_PASSWORD`,
`UNDERCROFT_KESTRA_PG_PASSWORD`, `UNDERCROFT_TRIGGER_TOKEN`, `UNDERCROFT_SECRET_KEY`,
`UNDERCROFT_SESSION_SECRET`, `UNDERCROFT_PUBLIC_URL`.

The per-source clients default to empty and are set when the source is offered:
`UNDERCROFT_GOOGLE_INGEST_CLIENT_ID/SECRET` (Gmail, Drive) and
`UNDERCROFT_XERO_CLIENT_ID/SECRET` (Xero, see [xero-setup.md](./xero-setup.md)). The Drive
Picker also needs `UNDERCROFT_GOOGLE_PICKER_API_KEY` and `UNDERCROFT_GOOGLE_PROJECT_NUMBER` on
the control plane; without them Gmail still connects and the Picker says it is unavailable
(see [google-ingestion-setup.md](./google-ingestion-setup.md)). The worker's optional
`UNDERCROFT_GOOGLE_MIN_INTERVAL_MS` overrides how far apart it paces Gmail and Drive requests.
A source whose client is unset cannot be connected, and the card says so; HubSpot needs no client, because
its token is pasted. Neither dbt nor BI has a password of its own any more: each build and
each question runs as the tenant's own login, whose password the worker mints right before
(ADR 0018). `UNDERCROFT_DBT_PASSWORD` and `UNDERCROFT_METABASE_PG_PASSWORD` are dead; remove them from
Dokploy's environment, with the `undercroft-bi.lowbit.link` domain, if they are still there.
CI never writes the blob.

**Each service connects as its own role.** `db-migrate` is the one service that connects as
the bootstrap superuser: it applies the schema and then sets `undercroft_app`'s and
`undercroft_worker`'s passwords from `UNDERCROFT_APP_PG_PASSWORD` and
`UNDERCROFT_WORKER_PG_PASSWORD`. The control plane and the worker connect as those roles, so
the grant model in `packages/db/sql` is what binds them — and a repo statement missing a grant
fails in the offline gate, where every suite runs as the role that runs it in production
(`db.become(...)` in `@undercroft/db/testing`). Without the two variables `db-migrate`
refuses to start.

## Tracing

Every request to the control plane or the worker answers with an `x-trace-id`. Every error
the UI or the CLI shows carries the same id, and every log line written while serving it does
too (ADR 0058). With `OTEL_EXPORTER_OTLP_ENDPOINT` set, spans and log lines also go to the
host's shared `otel-lgtm` stack. That stack is the `observability` project in Dokploy, not
ours, and Grafana for it is at `kanna-grafana.lowbit.link`.

**Turning export on** is one line in Undercroft's Dokploy environment, set by a person like
every value there (CI never writes the blob):

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-lgtm:4318
```

The worker reaches `otel-lgtm` because the server compose file attaches it to
`dokploy-network`. The control plane is already on that network for its domain. Unset, or
empty, means export is off: the ids are still stamped, and nothing leaves the host. Each
service logs `telemetry_exporting` or `telemetry_export_off` once at boot.

**Reading a trace** goes through `task obs:*`:

- `task obs:trace TRACE=<id>` shows the span tree.
- `task obs:logs FOR=<id>` shows the Loki lines.
- `task obs:search FOR=run=<runId>` finds the request that opened a run.
- `task obs:host-logs SERVICE=worker FOR=<id>` shows the raw container log over read-only SSH.

Each finds its own credentials: the Dokploy key from `DOKPLOY_API_KEY` or `.dokploy.json`,
Grafana's from the `otel-lgtm` compose, and the SSH host by matching the Dokploy host's IP
against `~/.ssh/config`. `task obs:creds` checks all three.

## Applying migrations

**A deploy applies them.** The `db-migrate` service runs `bun run migrate` from the
control-plane image, and both the control plane and the worker wait on
`service_completed_successfully` — so no service ever starts against a schema that lacks its
tables. It is idempotent and ledgered, so re-running each deploy costs one query.

It is a one-shot service rather than a call at service boot on purpose: the control plane may
one day run more than one replica, and two replicas racing the same DDL is a failure that
only appears under the load you least want it to.

To apply by hand — a database restored from backup, or a migration you want in before a
deploy:

```sh
UNDERCROFT_POSTGRES_DSN=... task db:migrate
```

It prints what it applied and what it skipped: "already up to date" and "applied 1
migration(s)" are different facts, and a log that cannot tell them apart is no evidence.

**If the schema is behind, sign-in does not degrade — it stops.** Better Auth raises
`SchemaMismatchError` and answers 500 to every `/api/auth/*` request, while still logging
`sign_in_configured` at boot. Look for `Database schema mismatch` with the missing table
names in the control-plane log.

## Sign-in

Invite-only, by Google or by a one-time code emailed to the address. See ADR 0010 for the
reasoning, and **[sign-in-setup.md](./sign-in-setup.md) for a step-by-step walkthrough** of
standing it up from nothing, including local development. What follows is the
production-specific part.

**Google client** — Cloud Console → APIs & Services → Credentials → OAuth client ID, type
_Web application_. Authorized redirect URIs, one per origin anyone signs in from:

| Origin          | Redirect URI                                      |
| --------------- | ------------------------------------------------- |
| production      | `https://<domain>/api/auth/callback/google`       |
| compose, local  | `http://localhost:13000/api/auth/callback/google` |
| Vite dev server | `http://localhost:5173/api/auth/callback/google`  |

The path is Better Auth's and is not configurable without changing `basePath`. The origin
must match `UNDERCROFT_PUBLIC_URL` exactly, because that is what the `redirect_uri` is built
from — a mismatch is Google's `redirect_uri_mismatch`, not a platform error.

Scopes stay at `openid email profile`. **Do not add Gmail or Drive scopes here.** Ingestion
credentials are a separate per-tenant consent held sealed in `app.connection_secret`; asking
for a mailbox as a side effect of signing in is the thing that arrangement exists to prevent.

**If sign-in is unconfigured** the control plane starts with no way in and logs
`sign_in_unconfigured` once, naming which of `UNDERCROFT_PUBLIC_URL`,
`UNDERCROFT_SESSION_SECRET`, the email settings and the Google pair are missing. Check that
line first; a button that fails at the first click is the failure this avoids.

### Bootstrapping the first admin

Invitations are issued from the **People** division once someone is in. Nobody is, on a fresh
deployment, and there is no one to invite them.

**Set `UNDERCROFT_SUPERADMINS` in Dokploy's environment and redeploy.** It is a
comma-separated list of addresses that may sign in with no invitation and that administer
every customer:

```
UNDERCROFT_SUPERADMINS=you@example.test,colleague@example.test
```

Name more than one. A single address here is a single point of lockout.

Those addresses can then sign in, create `CASE-0001` from the **Add a customer** form on the
Customers page — visible only to them — and invite everyone else from **People**. No shell,
no SQL, and the variable is the authority rather than a seed: removing an address and
redeploying withdraws it at the next request, which is also how you recover if every tenant
admin leaves. The boot log reports `superadmins_configured` with a count, never the
addresses. ADR 0013.

The older path still works and is the one to use for an ordinary invitation to a single
customer, run in the control-plane container, which already has the DSN:

```sh
docker exec -it undercroft-<stack>-control-plane-1 bun run invite -- \
  you@example.test --tenant CASE-0001 --role admin --create-tenant
```

`--create-tenant` is opt-in, so a mistyped tenant id cannot invent a customer. It writes an
ordinary invitation and grants nothing on its own; it also emails the invitee, using the
same wording the People page does, when the mail variables are set.

Then sign in with **exactly** that address. The first sign-in creates the `app.app_user`
row, redeems every live invitation for the address into `app.tenant_member`, and stamps
`accepted_at`. Signing in with a different address on the same Google account is refused,
not silently accepted — the invitation is keyed by the address.

From then on, use **People** inside the tenant: invite an address, pick a role, withdraw an
invitation that has not been accepted. An admin can invite; a member and a viewer cannot, and
the server refuses regardless of what the browser shows. The page reports whether the
invitation was actually emailed — with no mail configured it still works, and you have to
tell the person yourself.

## Rollback

**Which release is on screen is printed at the foot of every page of the control plane**, and
on the sign-in page too, so it can be read by someone who cannot get in. That stamp is the
tag the bundle was built from — paste it into `IMAGE_TAG` verbatim to come back to it.

Set `IMAGE_TAG=vX.Y.Z` (a previously published tag) in Dokploy's environment and redeploy.
The curated layer is a projection rebuilt from the raw lake, so a rollback needs no database
restore unless the schema changed.

The compose file does **not** roll back with it: the host clones `main`'s file whatever
`IMAGE_TAG` says (ADR 0049). That is harmless while the file has only gained what older
images ignore. If the release you are leaving changed the file in a way the older images
cannot run, revert that change on `main` as well.

**Put `IMAGE_TAG` back to `latest` once the fix ships.** While it is pinned, the host keeps
serving the pinned release, so the next release's deploy will fail `verify` — the running
digest is not the one ghcr serves for the tag being rolled out. That is the drift being
reported, not a bug in the check: the release genuinely did not reach the host.

## Administering Kestra

**The flows are delivered by the deploy.** `flows/` is baked into the control-plane image,
and the `kestra-flows` one-shot service runs `scripts/kestraFlows.ts` against Kestra's API
on every deploy — `PUT` per flow, `POST` when it is new — and exits non-zero on a flow Kestra
rejects, so the worker (which waits on it) never starts against a scheduler holding last
release's flow. There is nothing to upload by hand; a flow that is only on the server is
drift the next deploy reverts. There are two flows. `ingest_due` asks the worker every fifteen
minutes which (customer, source) pairs are due and starts each. `extract_due` asks hourly, at
:07, which pairs hold landed documents not yet read into `raw.document_text`, and starts an
extract run for each. A pair already running is a 409 both flows ignore.

Kestra has no domain by design — it is an operator surface holding execution history. To
inspect executions, tunnel to it over read-only SSH; a tunnel carries application data,
which is not a Dokploy configuration change and so is not the thing the API-only rule is
about.

Three Kestra behaviours that waste time otherwise:

- `{{ envs.x }}` resolves from **`ENV_X`**, not `KESTRA_X`. The prefix changed in 0.23
  deliberately: a `KESTRA_*` variable can override Micronaut config and become readable from
  every flow.
- Kestra **silently rejects a password that fails its complexity rules** — it 401s every
  request, including with the exact credentials configured. Use upper + lower + digit.
- A Kestra that **crash-loops with `AccessDeniedException` on `/app/storage/plugins`** has
  root-owned volumes. `kestra-init` hands them to uid 1000 on every deploy; if it did not run,
  no flow is ever registered and every run arrives as `trigger: manual`.

## Known gaps

- **Nobody needs SQL, and since ADR 0013 nobody needs a shell either.** The first admins come
  from `UNDERCROFT_SUPERADMINS` in Dokploy's environment (see [Sign-in](#sign-in)); everyone
  after that is invited from the People division.
- **The real `pg` + `search_path` path is exercised on deploy, not in the gate.** Better Auth
  emits unqualified table names against a pool whose `search_path` is `app`; the offline gate
  uses its memory adapter. A mistake here fails loudly (`Database schema mismatch`)
  rather than silently, and `bun run migrate` is what prevents it.
- **A real login is proven in the Docker tier, not the gate.** PGlite has no authentication,
  so the offline suites stand in a `SET ROLE` for a login. `task ci:itest` brings up the
  compose Postgres and opens a connection _as_ a tenant's role against it, proving it sees
  only its tenant and that `RESET ROLE` gives it nothing more. Run it after any change to
  `packages/db/sql`.
- The raw lake is not in a backup set — it is object storage with its own durability story,
  and the one layer that cannot be regenerated. Versioning and replication, not a nightly
  dump. Recorded rather than quietly omitted.
