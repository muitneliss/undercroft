# 8. Deploy on release, from CI, through the Dokploy API

- Status: Accepted
- Date: 2026-09-17

## Context

Undercroft is deployed on the Dokploy instance at `lowbit.link` as a single raw-compose
stack: MinIO, Postgres, Kestra, Metabase, the worker and the control plane. Two of those —
Metabase and the control plane — carry the first-party images this repo builds; the rest
are upstream.

The rebrand deleted the previous deployment story wholesale (the hosting ADR, the runbook,
`release-please`, every published-image reference), leaving a development compose file with
`build:` contexts that cannot run on a host with no repo checkout. There was no path from a
merged change to a running one, and no CI ever built an image.

## Decision

Publishing and deploying are gated on a release.

1. **release-please maintains a release PR** from Conventional Commits. Merging it bumps
   `version` in `package.json`, writes `CHANGELOG.md`, and cuts a tag.
2. **That, and only that, builds the images** (`ghcr.io/<owner>/undercroft-{worker,control-plane}`,
   tagged `vX.Y.Z` and `latest`, `linux/amd64`) and **deploys** them.
3. The deploy is driven by `scripts/dokploy.ts` against the Dokploy API:
   `preflight → deploy → verify → smoke`, with the deployment log collected on failure.

A push to `main` that is not a release ships nothing: no image changes, so restarting the
stack would only roll out the release already running.

## Why the API key, not a webhook

The deploy needs a full-privilege Dokploy API key in GitHub Actions secrets
(`DOKPLOY_API_KEY`, `DOKPLOY_COMPOSE_ID`). This **reverses** the pre-rebrand stance, which
kept shipping a manual act specifically to keep a production credential for a shared host
off GitHub.

The alternative — Dokploy's deploy webhook (`POST /api/deploy/compose/<refreshToken>`) — was
rejected for the same reason a comparable project rejected it: it returns no deployment id,
so nothing can poll it, verify what landed, or collect its log. Dokploy reports `done` for a
deploy that changed nothing and stays `done` from the previous release for the first seconds
after a trigger, so an unverified deploy is exactly how a release reports success while the
host runs the build before it. A verifiable rollout is worth the credential, which is scoped
to this one instance and revocable.

## Why verify compares config digests

`verify` asks the host which image each released container runs and compares its **config
digest** to the digest ghcr serves for the deployed tag — not the index digest, because
buildx provenance attestations change the index digest on every build, so two builds of an
identical image differ there. This is the only check that distinguishes "deployed" from
"Dokploy said done and changed nothing", and it runs before the smoke probes, which pass
against a healthy old stack.

## What CI does not touch

CI never writes the panel's configuration — not the compose file, not the environment blob.
`saveEnvironment` replaces the whole blob, which holds every live credential for the stack,
and the compose command is a human's to set. `preflight` instead _asserts_ the panel is
pointed at published images and carries `--pull always --wait --wait-timeout --remove-orphans`,
and refuses to deploy if it has drifted. A drift is seen and repaired by a person.

The deploy pointer is `IMAGE_TAG`, defaulting to `latest`. A rollback is `IMAGE_TAG=vX.Y.Z`
set in Dokploy's environment and a redeploy — no file change, no code change.

## Accepted risks

- **A production credential now lives in GitHub secrets.** Scoped to this Dokploy instance,
  revocable, and the price of a verifiable rollout. Recorded here rather than left implicit.
- **The control plane is public before its auth is wired.** It is served at
  `undercroft.lowbit.link` while `apps/control-plane` reads no session secret and `/trpc/*`
  falls back to an anonymous context, so its routers are reachable by anyone who finds the
  host. This was a deliberate call to get the surface deployed; it must not carry real tenant
  credentials until sessions and OAuth land. Follow-up: wire `UNDERCROFT_SESSION_SECRET` and
  the OAuth flow, then revisit before any customer connects an account.

## Options rejected

- **Deploy on every push to `main`.** Ships the running release again and restarts the whole
  stack for nothing; images only change on a release.
- **Manual-only deploy (the prior stance).** Keeps the credential off GitHub but leaves the
  gap that prompted this: no path from merge to running, and no verification discipline.
- **Deploy webhook.** No deployment id, so no poll, no verify, no log — see above.
