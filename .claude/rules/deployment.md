---
description: The Dokploy API is the only channel; every service declares a memory limit
paths:
  [
    "deploy/**",
    "flows/**",
    "scripts/dokploy.ts",
    ".github/workflows/deploy.yml",
    ".github/workflows/build-images.yml",
    ".github/workflows/release.yml",
  ]
---

# Deployment: one channel, explicit limits

Undercroft is a tenant on a Dokploy host shared with other projects. Two failure modes are
invisible from inside this repo and so are rules rather than habits: drifting from Dokploy's
recorded state, and starving a neighbour's service.

## NEVER

- **NEVER edit anything directly on the server.** A direct edit bypasses Dokploy's record of
  what it deployed; the next deploy silently reverts it.
- **NEVER invent a Dokploy endpoint name.** Fetch `settings.getOpenApiDocument` and search
  it. A plausible endpoint that does not exist fails in a way that reads like a permissions
  problem and costs an hour.
- **NEVER add a service with no memory limit.** CI asserts this over _both_ compose files;
  the host has no swap, so an unlimited container turns a spike into an OOM kill that takes a
  neighbour down.
- **NEVER let CI write the panel's configuration** — not the compose file, not the
  environment blob. `saveEnvironment` replaces the whole blob, which holds every live
  credential. `preflight` asserts the config; a human repairs a drift.

## Follow

- **The Dokploy API is the only channel for a change**, via `scripts/dokploy.ts` against
  `https://lowbit.link/api`. SSH is read-only, for diagnosis.
- **`deploy/compose/docker-compose.server.yml` is the source of truth**; Dokploy holds a
  copy, pushed as raw compose. Change the file here first, and keep it in step with the
  development compose — a change only in the dev file will not survive a deploy.
- **Every reference between services uses the `undercroft-` network alias**, never the bare
  service name. A domain-bearing service is attached to the shared `dokploy-network`, where
  `postgres` and `minio` belong to other projects too.
- **The deploy pointer is `IMAGE_TAG`.** A rollback is `IMAGE_TAG=vX.Y.Z` in Dokploy's
  environment and a redeploy — no file change.
- **A deploy is verified, not assumed.** `verify` compares running image config digests to
  ghcr before the smoke probes, because Dokploy reports `done` for a deploy that changed
  nothing. See ADR 0008.

`flows/` is the Kestra flow directory. This rule covers it from the first file so the
constraints are not retrofitted.
