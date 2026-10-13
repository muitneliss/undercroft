---
title: >-
  ADR 0136 Deploy on Push, Built on the Host, While GitHub Actions Is Out of
  Minutes
type: source
date: 2026-10-13
tags: []
source: docs/adr/0136-temporary-deploy-on-push-during-actions-outage.md
source_path: docs/adr/0136-temporary-deploy-on-push-during-actions-outage.md
source_hash: 80bed0d8f530ddd8b51188a89597e47474f7c74c1d911c7ccd10a8ef5dad6623
ingested: 2026-10-13
---

# ADR 0136 Deploy on Push, Built on the Host, While GitHub Actions Is Out of Minutes

Accepted 2026-10-13, temporary: it ends after GitHub Actions minutes reset on 2026-11-01. Amends [[ADR 0008 Deploy on Release from CI]] (only a release deploys, from CI) and [[ADR 0049: Dokploy clones the compose file from main]] (auto deploy off, the host never builds), with the SSH URL of [[ADR 0121 Dokploy Clones the Private Repository over SSH, with a Read-Only Deploy Key]] unchanged. Both stand again once the mode is switched off.

**Context.** The organization's Actions minutes are used up until 2026-11-01, the spending budget is $0 so usage is blocked rather than billed, and the repository is private, so every workflow is blocked: `ci`, `release`, `build-images`, `deploy`, `blog`, `desktop` and `visual`. Under ADR 0008 and ADR 0049 that stops production, because a deploy is a release and the server compose file runs only images a workflow published. Turning the panel's auto deploy on alone would clone `main` and restart the same `ghcr.io/...:latest` images.

**Decision.** Until the reset, Dokploy deploys every push to `main` itself, building the first-party images on the host. (1) `deploy/compose/docker-compose.server.build.yml` is an override layered on the server file, never used alone: `worker` and `control-plane` get a `build:` from the clone under local names (`undercroft-worker:main`, `undercroft-control-plane:main`, never a ghcr name), and `db-migrate` and `kestra-flows` name the control-plane image with `pull_policy: never`, since compose builds every image before creating a container; memory limits, aliases and dependencies stay in the base file. (2) The stored command names both files and runs `up -d --build --wait --wait-timeout 600 --remove-orphans` with no `--pull`, because that flag overrides every service's `pull_policy` and `--pull missing` sent the two one-shots to Docker Hub for an image only the build produces (seen in a `docker compose --dry-run`, compose v5.1.2). (3) `autoDeploy` is on, `watchPaths` limited to `apps/**`, `packages/**`, `deploy/**`, `flows/**`, `specs/**`, `skills/**`, `package.json` and `bun.lock`, and a GitHub push webhook posts to the panel's `/api/deploy/compose/<refreshToken>`. (4) The seven workflows are disabled. `task cd:outage-on` and `task cd:outage-off` (`scripts/dokploy.ts outage on|off`) make and undo all four; they are the one place the repository writes the panel's configuration, a person's tools that no workflow calls, and `outage off` ends by running `preflight`, so an incomplete switch back fails while someone is watching. `preflight` is not relaxed: while the mode is on it is expected to fail, and its refusal names `task cd:outage-off` as the way back.

**Consequences.** The host builds two images per deploy on a machine shared with other projects (8 cores, 22 GiB, about 10 GiB free), outside the compose memory limits, which bind containers rather than BuildKit. Nothing gates a pull request: a local `task ci:verify` is the only check, and every watched push is a production deploy. No tags, CHANGELOG, release-please PRs or ghcr images; the next release after the switch back carries everything merged meanwhile. `task cd:verify` does not apply, so `cd:status`, `cd:logs` and `cd:smoke` check a deploy, and `--wait` still stops a crash-looping container from deploying green. `UNDERCROFT_RELEASE` stays blank rather than guessed. The blog, desktop and CLI releases are paused; the server still serves its own CLI tarball ([[ADR 0135 The Instance Serves Its Own CLI]]). The file and code ship from one commit, so ADR 0049's file-from-`main`, images-from-the-release mismatch cannot arise. A rollback is a revert on `main`, or `task cd:outage-off` then `task cd:release TAG=v1.76.0`.

**Rejected.** Auto deploy alone (restarts the images ghcr already serves); building and pushing images from a laptop (no record of which commit, and a ghcr write credential on that machine); a self-hosted runner (runs every branch's workflow code on a machine we keep, more setup and securing than three weeks justify); paying for minutes (the owner's choice not to).

**Exit.** After 2026-11-01: run `task cd:outage-off`, whose closing `preflight` must pass; then a pull request deletes the override file, the `outage` section of `scripts/dokploy.ts` with its test and two tasks, the runbook's "Actions outage mode" section and the `CLAUDE.md` pointer, and adds an ADR superseding this one -- which is not edited. The release that PR produces is the first deploy back under ADR 0008. See [[Runbook Deployment]].
