---
title: ADR 0008 Deploy on Release from CI
type: source
date: 2026-09-18
tags: []
source: docs/adr/0008-deploy-on-release-from-ci.md
source_path: docs/adr/0008-deploy-on-release-from-ci.md
source_hash: 40da8caff071faa59025b58e0439fba1873c714c63b7a2b867deb5a4a0ebf612
ingested: 2026-09-18
---

# ADR 0008 Deploy on Release from CI

## Context

Undercroft is deployed on the Dokploy instance at `lowbit.link` as a single raw-compose
stack: MinIO, Postgres, Kestra, Metabase, the worker and the control plane. Only Metabase
and the control plane carry first-party images from this repo.

The rebrand deleted the previous deployment story wholesale, leaving a development compose
file with `build:` contexts that cannot run on a host with no repo checkout. There was no
path from a merged change to a running one, and no CI ever built an image.

## Decision

Publishing and deploying are **gated on a release**.

1. **release-please maintains a release PR** from Conventional Commits. Merging it bumps
   `version`, writes `CHANGELOG.md`, and cuts a tag.
2. That, and only that, builds the images
   (`ghcr.io/<owner>/undercroft-{worker,control-plane}`, tagged `vX.Y.Z` and `latest`,
   `linux/amd64`) and deploys them.
3. The deploy runs `scripts/dokploy.ts` against the Dokploy API:
   `preflight → deploy → verify → smoke`, collecting the deployment log on failure.

A push to `main` that is not a release ships nothing.

## Why the API key, not a webhook

The deploy needs a full-privilege Dokploy API key in GitHub Actions secrets. This
**reverses** the pre-rebrand stance of keeping a production credential off GitHub.

Dokploy's deploy webhook was rejected because it returns no deployment id, so nothing can
poll it, verify what landed, or collect its log. Dokploy reports `done` for a deploy that
changed nothing and stays `done` from the previous release for the first seconds after a
trigger — so an unverified deploy is exactly how a release reports success while the host
still runs the build before it. A verifiable rollout is worth a credential scoped to one
instance and revocable.

## Why verify compares config digests

`verify` asks the host which image each released container runs and compares its **config
digest** to the digest ghcr serves for the deployed tag — not the index digest, because
buildx provenance attestations change the index digest on every build, so two builds of an
identical image differ there. This is the only check distinguishing "deployed" from
"Dokploy said done and changed nothing", and it runs before the smoke probes, which pass
against a healthy old stack.

## What CI does not touch

CI never writes the panel's configuration — not the compose file, not the environment blob.
`saveEnvironment` replaces the whole blob, which holds every live credential. `preflight`
instead *asserts* the panel is pointed at published images and refuses to deploy on drift.
A drift is seen and repaired by a person.

The deploy pointer is `IMAGE_TAG`, defaulting to `latest`. A rollback is `IMAGE_TAG=vX.Y.Z`
and a redeploy — no file change.

## Accepted risks

* **A production credential now lives in GitHub secrets.** Scoped, revocable, and the price
  of a verifiable rollout.
* **The control plane is public before its auth is wired.** Recorded as a deliberate call to
  get the surface deployed, with a follow-up to wire the session secret and OAuth flow.

## Options rejected

* **Deploy on every push to `main`.** Ships the running release again and restarts the whole
  stack for nothing.
* **Manual-only deploy (the prior stance).** Keeps the credential off GitHub but leaves no
  path from merge to running, and no verification discipline.
* **Deploy webhook.** No deployment id, so no poll, no verify, no log.

## Related

The accepted risk about the control plane being public before its auth was wired is closed
by [[ADR 0010 Invite-Only Sign-In with Better Auth]]. This ADR is left as written — an
accepted ADR records what was decided then. The operational half is [[Runbook Deployment]].
