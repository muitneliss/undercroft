---
title: 'ADR 0095: Undercroft installs through a setup wizard that drives Docker'
type: source
date: 2026-09-30
tags: []
source: docs/adr/0095-undercroft-installs-through-a-setup-wizard-that-drives-docker.md
source_path: docs/adr/0095-undercroft-installs-through-a-setup-wizard-that-drives-docker.md
source_hash: be806e8a85c15a6088b067c754bef2e9b254e4b863749781dda182ae80e5fa31
ingested: 2026-09-30
---

# ADR 0095: Undercroft installs through a setup wizard that drives Docker

A person installs Undercroft on Windows, macOS or Linux by running one program, the setup wizard, which installs the same Docker compose stack the server runs, pulled from ghcr at the installer's own pinned release. `packages/setup` is the one owner of install logic and is UI-agnostic: it takes a process runner, an install folder, `fetch` and a clock, and answers with values and problem codes, never sentences. `apps/installer-cli` is the Clack terminal wizard over it (Vietnamese first); an Electrobun GUI wizard is the next front end over the same service.

Two modes. Desktop: one person, the control plane published on 127.0.0.1 only and opened at `http://localhost:<port>`, the owner `owner@undercroft.local` signed in without proof as the one superadmin (ADR 0094). Server: an https public URL behind the operator's own reverse proxy, an administrator in `UNDERCROFT_SUPERADMINS` ([[ADR 0013 Superadmins Named in the Environment]]), and a sign-in method that proves an address (Resend key or Google client).

`deploy/compose/docker-compose.install.yml` is the server file ([[ADR 0049: Dokploy clones the compose file from main]]) without `dokploy-network`, with only the control plane published on `UNDERCROFT_BIND`, `IMAGE_TAG` required, and `UNDERCROFT_DEV_SIGN_IN_AS` passed through; a test fails the gate when its services or images drift from the server file. The installer embeds the file at build time, and every write moves an install to the installer's own release so the file and images never come from two releases. Secrets are generated on the machine (CSPRNG) once and never regenerated; a re-run changes only answer-driven lines and keeps hand-added ones; a folder with no `.env` beside an earlier install's Postgres volume is refused as `orphaned-data`. Each release attaches one `bun build --compile` binary per platform under shared names, `undercroft-installer-SHA256SUMS` and `install.sh`, the channel of [[ADR 0046: The CLI installs once, from the latest release]].

Rejected: natively re-bundling Postgres, dbt, MinIO and Kestra (four runtimes per OS; PGlite has no roles, RLS or wire protocol); Tauri (a Rust shell in a TypeScript-only repo); Qt Installer Framework, InstallBuilder, InstallAware (a second UI stack or commercial, and a file-copying wizard around work we would still write); NSIS or Inno Setup (Windows only). Consequences: Docker is required and the limits total about 8 GB; Docker Desktop needs a paid subscription above 250 employees or USD 10 million revenue; the binaries are not code-signed; Kestra replacement and automatic TLS via Caddy are follow-ups; `update --tag` to an older release is a rollback escape hatch.
