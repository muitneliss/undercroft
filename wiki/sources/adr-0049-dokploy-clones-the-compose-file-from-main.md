---
title: 'ADR 0049: Dokploy clones the compose file from main'
type: source
date: 2026-09-24
tags: []
source: docs/adr/0049-dokploy-clones-the-compose-file-from-main.md
source_path: docs/adr/0049-dokploy-clones-the-compose-file-from-main.md
source_hash: d4881fcf52fdc990b59ad1c88752b868cc79b7fad13186d500dfcafa35e9646e
ingested: 2026-09-24
---

# ADR 0049: Dokploy clones the compose file from main

Accepted 2026-09-24. Amends the context of [[ADR 0008 Deploy on Release from CI]], which described the stack as "raw compose" without ever deciding it; 0008's decision (deploy only on a release, from CI, through the API, CI never writing the panel) stands unchanged.

**Context.** `deploy/compose/docker-compose.server.yml` was called the source of truth, but the panel never read it: the compose was a Dokploy **raw** source holding a pasted copy, kept equal to the file by hand. That step was missed twice. First the copy drifted until it ran a deleted service ([[ADR 0020: BI is first-party, Metabase leaves the stack]]) and three releases failed at `--wait`, after which `preflight` learnt to compare the copy line for line. Then #173 added two variables, nobody pasted the file, and v1.26.0 stopped at `preflight` until someone pushed it by hand. The check made drift visible; it did not remove the manual step.

**Decision.** The panel's compose source is `git`: `https://github.com/muitneliss/undercroft.git`, branch `main`, compose path `deploy/compose/docker-compose.server.yml`, **auto deploy off**. Every deploy clones `main` (`git clone --branch main --depth 1`, Dokploy v0.30.6) and runs the file from the clone, so the panel holds no copy and merging a change to the file is the whole rollout. The stored command names the file's own paths, `--env-file deploy/compose/.env -f deploy/compose/docker-compose.server.yml`, because Dokploy runs it from the clone's root and writes `.env` beside the compose file. `preflight` now asserts the source settings, that `main`'s file (read through GitHub's contents API, not the CDN, which can be five minutes stale) equals the checkout's byte for byte bar line endings and trailing blank lines, and the command flags. `verify` reads the checkout's file, never the panel's `composeFile`, which under a git source is a stale paste nothing deploys. The source is set once by a person through `compose.update` with only those fields, never `env`.

**Consequences.** The file ships from `main` and the images from the release: a change to the file merged while a release's images built would ship beside images that predate it, so `preflight` refuses and the next release carries it. A rollback (`IMAGE_TAG=vX.Y.Z`) moves the images but not the file; a file change older images cannot run must be reverted on `main` too. The host now has a checkout but nothing uses it for code: first-party services stay on published images and the Kestra flows stay baked into the control-plane image, because both are what a release fixes and `verify` proves by digest. GitHub is on the deploy path, failing closed. The repository must stay public or the source needs a deploy key.

**Rejected.** Pushing the raw copy from CI after merge (makes CI a panel writer, still two copies); a stricter check on the raw copy (what failed v1.26.0); cloning the release tag (the tag changes each release, so someone must write it into the panel); a GitHub provider source (needs an App for a public repo, and its push webhook is another deploy trigger 0008 forbids).

See [[Runbook Deployment]].
