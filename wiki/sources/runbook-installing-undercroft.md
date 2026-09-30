---
title: 'Runbook: Installing Undercroft'
type: source
date: 2026-09-30
tags: []
source: docs/runbook/install.md
source_path: docs/runbook/install.md
source_hash: c95b6e642e28000e269f3c803decb774dafeb010d21709e57541c7446a22a0b0
ingested: 2026-09-30
---

# Runbook: Installing Undercroft

How to install, operate, back up and remove a self-installed Undercroft; the decision is [[ADR 0095: Undercroft installs through a setup wizard that drives Docker]]. Needs Docker (the wizard offers winget, Homebrew or a download, or `get.docker.com`), at least 8 GB for Docker, about 15 GB of disk, and for a server an https reverse proxy plus a sign-in method ([[Runbook Sign-In Setup]]). Docker Desktop needs a paid subscription for companies above 250 employees or USD 10 million revenue.

macOS and Linux: `curl -fsSL https://github.com/muitneliss/undercroft/releases/latest/download/install.sh | sh`, which verifies the binary against `undercroft-installer-SHA256SUMS`, keeps it as `~/.local/bin/undercroft-installer` (`UNDERCROFT_BIN_DIR`), and runs it; `UNDERCROFT_VERSION=vX.Y.Z` pins a release. Windows: double-click `undercroft-installer-windows-x64.exe` (unsigned, so SmartScreen may warn). The wizard asks language, desktop or server, checks Docker, then port, server address, administrator, sign-in method and bind address, then optional Gmail/Drive or Xero clients (HubSpot needs nothing), installs, waits for `/api/health`, prints redirect URIs, and on a desktop opens the browser. A desktop install must be opened at exactly `http://localhost:<port>`: the owner's sign-in refuses `127.0.0.1` (ADR 0094). The `undercroft` CLI signs the owner in the same way, with no code, at the same address, and a desktop install's last lines print the two commands ([[ADR 0096: The CLI signs in to a local install the way the browser does]], [[Runbook: The undercroft CLI]]). Every answer is also a flag; `--yes` asks nothing and never installs Docker; `--dry-run` writes nothing and calls no Docker.

The install folder is `~/.undercroft` or `%LOCALAPPDATA%\Undercroft` (or `--dir`), holding `.env` (0600, every secret) and the wizard-written `docker-compose.yml`; data lives in `undercroft-install_*` volumes, and one machine holds one install. Commands: `status`, `logs [service]`, `down`, `update` (move to the installer's release; `--tag` is a rollback escape hatch), `uninstall` (`--keep-data` keeps data and `.env`; images stay in Docker's cache). Back up the `.env` (it holds `UNDERCROFT_SECRET_KEY` and the volumes' passwords) and the `minio-data` volume, the raw lake ([[ADR 0001 Raw Lake Is the Only Durable Layer]]). Troubleshooting covers the docker group, Compose v2, `orphaned-data`, missing arm64 images, a busy port, a slow first start and macOS quarantine. Tasks: `ci:installer-check`, `build:installer-cli`, `cd:installer-upload`, `ci:compose-check`.
