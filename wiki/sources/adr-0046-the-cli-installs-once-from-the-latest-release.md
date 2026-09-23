---
title: 'ADR 0046: The CLI installs once, from the latest release'
type: source
date: 2026-09-23
tags: []
source: docs/adr/0046-the-cli-installs-once-from-the-latest-release.md
source_path: docs/adr/0046-the-cli-installs-once-from-the-latest-release.md
source_hash: 7008b4a44dcb3d35086911103c2095bca837e6156a240607f8f6311a4991c5ee
ingested: 2026-09-23
---

# ADR 0046: The CLI installs once, from the latest release

Accepted 2026-09-23. Supersedes, in how the CLI gets onto a machine, the "Distribution is a GitHub release asset, installed by the skill" section of [[ADR 0044: An agent reaches Undercroft as a caller]]; it keeps that ADR's rule that a release asset is the only place a version is published from.

**Decision.** Each release attaches the packed CLI twice, as `undercroft-cli-X.Y.Z.tgz` and as `undercroft-cli.tgz` (same bytes); `task cd:cli-upload` attaches both. A person installs once with `npm install -g`, from `releases/latest/download/undercroft-cli.tgz` for the newest release or the versioned URL for one exact release. The skill still pins its release but no longer runs every command through `npx --package=<URL>`: the agent runs `undercroft --version` first, installs the pinned release with `npm install -g` when the CLI is missing, asks the person before replacing a different installed release, and falls back to `npx` on the pinned URL when the global install is refused.

**Why.** ADR 0044's README snippet made a person edit a version and define a shell function that ran `npx` on every call; it vanished with the terminal and re-downloaded whenever npm's cache dropped the package. GitHub resolves `releases/latest/download/<name>` only for a name every release shares, so the unversioned copy gives the newest CLI one fixed URL with no registry or token. The skill keeps its pin because its text documents one release's commands and error codes.

**Rejected.** Publishing `undercroft` to npm (most familiar, name unclaimed on 2026-09-23, but reverses ADR 0044's single place of publication and adds a token or trusted publishing — a candidate for a later ADR); standalone `bun build --compile` binaries with a `curl | sh` installer (per-platform builds, macOS notarization, oclif under Bun unproven); a Homebrew tap (a second repository to keep in step).

**Consequences.** Upgrading is re-running the install line, with no notice of a newer release. `npm install -g` writes to npm's global prefix; a system-wide Node would need `sudo`, which the runbook advises against and the skill forbids an agent. Releases published before this ADR lack `undercroft-cli.tgz` until `task cd:cli-upload` is re-run for them.
