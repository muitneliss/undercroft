---
title: 'Runbook: Installing Undercroft'
type: source
date: 2026-09-30
tags: []
source: docs/runbook/install.md
source_path: docs/runbook/install.md
source_hash: 74eacc544db9702a19de830926760b391bc825e4429ba20525d5ceaf35149b71
ingested: 2026-09-30
---

# Runbook: Installing Undercroft

# Runbook: Installing Undercroft

How to install, operate, back up and remove a self-installed Undercroft; the decisions are [[ADR 0095: Undercroft installs through a setup wizard that drives Docker]] and, for the desktop app, [[ADR 0098: The desktop installer is an Electrobun app over the setup service]]. The wizard comes two ways that install the same thing into the same folder: the desktop app (a window and a tray icon) and the terminal wizard `undercroft-installer`, which also runs unattended. Needs Docker (the wizard offers winget, Homebrew or a download, or `get.docker.com`), at least 8 GB for Docker, about 15 GB of disk, and for a server an https reverse proxy plus a sign-in method ([[Runbook Sign-In Setup]]). Docker Desktop needs a paid subscription for companies above 250 employees or USD 10 million revenue.

Terminal wizard. macOS and Linux: `curl -fsSL https://github.com/muitneliss/undercroft/releases/latest/download/install.sh | sh`, which verifies the binary against `undercroft-installer-SHA256SUMS`, keeps it as `~/.local/bin/undercroft-installer` (`UNDERCROFT_BIN_DIR`), and runs it; `UNDERCROFT_VERSION=vX.Y.Z` pins a release. Windows: double-click `undercroft-installer-windows-x64.exe` (unsigned; SmartScreen's More info, Run anyway). The wizard asks language, desktop or server, checks Docker, then port, server address, administrator, sign-in method and bind address, then optional Gmail/Drive or Xero clients (HubSpot needs nothing), installs, waits for `/api/health`, prints redirect URIs, and on a desktop opens the browser. A desktop install must be opened at exactly `http://localhost:<port>`: the owner's sign-in refuses `127.0.0.1` ([[ADR 0094: A local install signs its owner in on loopback]]); the `undercroft` CLI signs the owner in the same way, with no code, at the same address, and a desktop install's last lines (and the desktop app's Done step) print the two commands ([[ADR 0096: The CLI signs in to a local install the way the browser does]]). Every answer is also a flag; `--yes` asks nothing and never installs Docker; `--dry-run` writes nothing.

Desktop app. Downloads: `macos-arm64-Undercroft.dmg` (Apple Silicon only; an Intel Mac uses the terminal wizard), `win-x64-Undercroft-Setup.zip` (x64 and Arm), `linux-x64-Undercroft-Setup.tar.gz` (needs GTK 3, WebKitGTK 4.1, an app-indicator library and librsvg). First run: on macOS right-click Open, or System Settings > Privacy & Security > Open Anyway, or `xattr -dr com.apple.quarantine`, after which the app unpacks into `~/Library/Application Support/link.lowbit.undercroft/`; on Windows SmartScreen's More info, Run anyway; on Linux no extra step. The wizard has the same steps one to a page; it installs Docker itself only on Windows (winget, then a restart that reopens the wizard at Docker), shows the command and a download elsewhere, asks for the install folder, shows each provider's redirect URI before a client is pasted, lists each image as it pulls, and Done opens `http://localhost:<port>` signed in. The tray: Open, Start (at the app's release), Stop, Status, Settings (the wizard over the existing install, secrets kept), Logs folder (`install.log`), Check for updates (from the latest release), Uninstall (keep data, or delete everything asked twice), Quit. Build from source with `task build:desktop`, or run a development copy with `task dev:desktop`.

Unsigned downloads: nothing is code-signed; trust rests on public source, public CI and the published SHA-256 checksums (`undercroft-desktop-SHA256SUMS`, `undercroft-installer-SHA256SUMS`), with commands to check each on macOS, Linux and Windows. A browser download on macOS is quarantined; `curl` and `install.sh` are not.

The install folder is `~/.undercroft` or `%LOCALAPPDATA%\Undercroft` (or `--dir`), holding `.env` (0600, every secret) and the wizard-written `docker-compose.yml`; data lives in `undercroft-install_*` volumes, and one machine holds one install. Commands: `status`, `logs [service]`, `down`, `update` (`--tag` is a rollback escape hatch), `uninstall` (`--keep-data`). Back up the `.env` and the `minio-data` volume, the raw lake ([[ADR 0001 Raw Lake Is the Only Durable Layer]]). Troubleshooting covers the docker group, Compose v2, `orphaned-data`, missing arm64 images, a busy port, a slow first start and macOS quarantine. Tasks: `ci:installer-check`, `ci:desktop-check`, `build:installer-cli`, `build:desktop`, `cd:installer-upload`, `cd:desktop-release`, `ci:compose-check`.
