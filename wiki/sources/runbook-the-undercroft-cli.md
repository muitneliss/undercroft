---
title: 'Runbook: The undercroft CLI'
type: source
date: 2026-09-23
tags: []
source: docs/runbook/cli.md
source_path: docs/runbook/cli.md
source_hash: f96a5cb5ff6893c39f7c62feb3154321f28ef0be30aab6265f1cbaa6f45c4b98
ingested: 2026-09-23
---

# Runbook: The undercroft CLI

How to use and change the `undercroft` CLI; the decisions are [[ADR 0044: An agent reaches Undercroft as a caller]]. In this repo it runs as `task dev:cli -- <command>` (build, then `node apps/cli/dist/undercroft.mjs`); a released CLI runs through `npx -y --package=<release tarball URL> undercroft`; an agent gets it with `npx skills add muitneliss/undercroft --skill undercroft-cli`. It needs Node 22.

A person creates a profile per environment (`config set-profile local --url http://localhost:3000 --allow-writes`, which only works at a terminal), signs in with `auth login` (email, then the emailed code), and runs commands; a missing tenant is asked for from `tenants list`. An agent passes `--agent` (also inferred from a non-TTY stdin/stdout) and gets exactly one JSON envelope on stdout; it signs in in two invocations (`--email`, then `--email --code`). The envelope, codes and exit codes are in `skills/undercroft-cli/references/cli-contract.md`.

Files live in `$UNDERCROFT_CLI_HOME`, else `$XDG_CONFIG_HOME/undercroft`, else `~/.config/undercroft`: `config.json` (profiles) and `credentials.json` (0600, sessions keyed by origin). `undercroft.cli.json` pins a project's profile; `--url`/`UNDERCROFT_URL` is a one-off that never allows writes; `config show` explains which source decided each value and never prints the session.

A new procedure needs only a sentence under `procedures` in `apps/cli/src/i18n/{vi,en}.ts`, and a new mutation its effect in `apps/cli/src/procedures.ts`; `task build:cli` refuses either omission. `apps/cli/src/cli.test.ts` builds the bundle into a temp dir and runs it under `node` against `startControlPlane()` from `@undercroft/control-plane/testing`. `task ci:cli-pack-check` runs the packed tarball through `npx`; `task ci:skill-check` (network) checks `npx skills` lists the skill. The `release-cli` job runs `task build:cli-pack` then `task cd:cli-upload TAG=vX.Y.Z`. Troubleshooting: `CONFIG_REQUIRED` (no profile or URL), `AUTHENTICATION_REQUIRED` right after signing in (a different origin, e.g. `localhost` vs `127.0.0.1`), `WRITES_DISABLED` (a person must allow writes), `NETWORK_ERROR` (the URL does not answer `/trpc` as tRPC).
