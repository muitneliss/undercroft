---
title: 'ADR 0097: The desktop installer is an Electrobun app over the setup service'
type: source
date: 2026-09-30
tags: []
source: >-
  docs/adr/0097-the-desktop-installer-is-an-electrobun-app-over-the-setup-service.md
source_path: >-
  docs/adr/0097-the-desktop-installer-is-an-electrobun-app-over-the-setup-service.md
source_hash: 07baa3f8999e5c7c8845b8306489e640e575cfd66f6f365463645e660659df48
ingested: 2026-09-30
---

# ADR 0097: The desktop installer is an Electrobun app over the setup service

`apps/desktop` is the graphical front end [[ADR 0095: Undercroft installs through a setup wizard that drives Docker]] named: an Electrobun 2 app pinned exactly (`electrobun` 2.0.2 in `package.json`; Hutch 0.27.1 and Cottontail 0.7.1 in the `hutch.config.ts` pragma), a window running the same wizard as the terminal one and a tray icon that operates the install afterwards. Electrobun 2 no longer ships its SDK through npm: the `electrobun` package bootstraps Hutch, which projects the SDK into `.hutch/devkit` and builds the app, and its default main-process runtime is Cottontail.

Decision. The main process is Bun, not Cottontail, so it imports `@undercroft/setup` as it is (child processes, `node:crypto`, the compose file embedded as text), and Bun is Hutch's package manager so the workspace keeps one lockfile. The app adds no install decision: `services/desktop.ts` owns where the install is (remembered folder, else the shared default), one compose operation at a time, and progress as values; `services/dockerSetup.ts` runs only winget unattended (brew and sudo would need a terminal) and resumes the wizard at the Docker step after a Windows restart. The defaults both front ends must agree on (install folder, port, bind, redirect URIs) moved into `@undercroft/setup`. The view is React with one Zustand store, under the `no-usestate` gate ([[ADR 0009 UI State in Zustand, useState Banned]]), validating with `@undercroft/setup/answers`, a subpath that imports nothing. Only three modules import the SDK (the composition root, the view's bridge and entry); everything else is written against `rpc.ts` and the `handlers/shell.ts` port, so the offline gate covers it and `task ci:desktop-check` typechecks the three against the real SDK, builds the app and launches it to walk itself to the Docker step. The app opens exactly `http://localhost:<port>` ([[ADR 0094: A local install signs its owner in on loopback]]). Updates come from `releases/latest/download` under Electrobun's own artifact names, with patches off. Release artifacts (macOS Apple Silicon, Windows x64, Linux x64, each built on its own runner) are unsigned and published with `undercroft-desktop-SHA256SUMS`.

Rejected: signed distribution for want of accounts (no Apple Developer ID, no certificate; Azure Artifact Signing is unavailable to individuals and organisations in Vietnam), which a later ADR can add; Electrobun 1.18 (the superseded line); Cottontail as the main process (its Node compatibility can differ exactly where this app works: spawning and reading pipes); Tauri (a Rust shell); Electron (a bundled Chromium, where this app's dmg is 21 MB); importing `apps/ui`'s stylesheet; a Content-Security-Policy (under `default-src 'self' views:` Electrobun 2.0.2's preload bridge never answered). Consequences: Gatekeeper and SmartScreen warn, and SmartScreen reputation for an unsigned file restarts with every release; no Intel Mac build; three more release runners and a three-OS pull-request check; the gate cannot see the three SDK modules; updates are whole archives (about 20 MB on macOS); release-please bumps `apps/desktop/package.json`. How to install is [[Runbook: Installing Undercroft]].
