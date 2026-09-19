---
title: Runbook Deployment
type: source
date: 2026-09-19
tags: []
source: docs/runbook/deployment.md
source_path: docs/runbook/deployment.md
source_hash: 6b06df6204b6f9904ca9ff70ed55655233bafc7001b1175d6db6865ffb877e34
ingested: 2026-09-19
---

# Runbook Deployment

How Undercroft reaches and stays on the Dokploy host `lowbit.link` as one raw-compose stack. Merging the release-please PR cuts a tag; CI builds the images and runs `scripts/dokploy.ts preflight → deploy → verify → smoke`, where `verify` compares the running image config digests against ghcr rather than trusting Dokploy's `done`, and treats one-shot services (`db-migrate`) as "must have exited 0" by reading the compose file's own `service_completed_successfully` declarations.

Environment variables: Dokploy only injects what a service's `environment:` block names; the `:?set in .env` variables hard-fail the stack if unset. Since release 1.8 each service connects to Postgres as its own role: `db-migrate` is the one service using the bootstrap superuser, applies the schema, then sets `undercroft_app`'s and `undercroft_worker`'s passwords from `UNDERCROFT_APP_PG_PASSWORD` and `UNDERCROFT_WORKER_PG_PASSWORD`, so the grant model in `packages/db/sql` actually binds; the offline suites run as those roles via `db.become(...)`.

Migrations are applied by the `db-migrate` one-shot before any service starts (idempotent, ledgered); the runbook also covers applying by hand, sign-in setup and the first superadmin, rollback by pinning `IMAGE_TAG` to a published tag (the release stamp is printed in every page's colophon), and administering Kestra over a read-only SSH tunnel (`{{ envs.x }}` reads `ENV_X`; Kestra silently 401s on a password that fails its complexity rules).

Known gaps: the real `pg` + `search_path` path is exercised on deploy, not in the gate; a real login (not `SET ROLE`) is proven only by `bun run itest` against the compose Postgres, which must be run after any change to `packages/db/sql`; the raw lake is not in a backup set.
