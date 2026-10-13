---
title: ADR 0135 The Instance Serves Its Own CLI
type: source
date: 2026-10-13
tags: []
source: docs/adr/0135-the-instance-serves-its-own-cli.md
source_path: docs/adr/0135-the-instance-serves-its-own-cli.md
source_hash: efef3f128a36fb8156b85969d7387ad9d5e0ec4f1951c5020309cbc3275797a1
ingested: 2026-10-13
---

# ADR 0135 The Instance Serves Its Own CLI

Accepted 2026-10-13. Supersedes, in part, the "Distribution is a GitHub release asset, installed by the skill" section of [[ADR 0044: An agent reaches Undercroft as a caller]] and the install lines of [[ADR 0046: The CLI installs once, from the latest release]], in where a person or an agent installs the CLI from; the release keeps attaching the tarball under both of ADR 0046's names.

**Context.** Issue 465. The skill and the CLI runbook installed the CLI from a GitHub release URL. Once the repository was private ([[ADR 0121 Dokploy Clones the Private Repository over SSH, with a Read-Only Deploy Key]]) those URLs answered 404 to anyone without access, and to npm, which sends no GitHub credential. The person installing has a sign-in to an Undercroft server, not to the repository, and needs the CLI built from that server's commit, because the build reads the router's procedures.

**Decision.** The control plane serves the CLI tarball of its own build at `GET /cli/undercroft-cli.tgz`, and the skill and runbook install from it (`npm install -g "https://<their Undercroft>/cli/undercroft-cli.tgz"`, with the same URL through `npx` when a global install is refused). (1) `deploy/Dockerfile.control-plane` has a `cli` stage on the SPA stage's dev install that runs `build:cli-pack` (`apps/cli/scripts/pack.ts`), the release's own script, and the runtime names the file in `UNDERCROFT_CLI_TARBALL`. (2) The pack uses `bun pm pack`, since the image has no Node; it is the same npm layout, `task ci:cli-pack-check` proves npm installs and runs it, and every entry carries one fixed time, so a pack is reproducible. (3) `cliTarball.ts` reads the file once at boot beside the image's other files (`ImageFiles`); a failure is logged and the server boots without it, and a process from a checkout serves none rather than a stale pack. (4) Nothing under `/cli/` is a browser route: a missing tarball or another name answers 404 in the caller's language, never the SPA shell, which npm would report as `TAR_BAD_ARCHIVE`. (5) No sign-in: the tarball is a client of `/trpc` holding each procedure's path, schema and sentences, which the SPA bundle and `/trpc` already show anyone, and npm could not carry a session. (6) `skills/undercroft/references/cli.md` keeps a release-please block naming the release it describes, compared with `undercroft --version`; `scripts/skills.test.ts` holds it to exactly one version, the release's. A server older than this release answers with HTML, and a person with repository access then installs that release with `gh release download`.

**Rejected.** Publishing to the npm registry (an npm credential, and the newest version is not the server's); a public mirror or bucket for the assets (a second place to publish to); serving it behind a sign-in (npm cannot carry the session, and the CLI is how a person signs in from a terminal); packing in the release job and passing the file into the image build (couples two parallel jobs, and a local `docker build` would need a pack first); streaming from disk per request (a few hundred kilobytes, read at boot so the handler never touches the filesystem).

**Consequences.** Upgrading the CLI is re-running the line after the server is upgraded, with no notice. A server holds about 200 KB in memory. A checkout serves no CLI; `task dev:cli` is the way in there. The release asset is now what `gh release download` fetches for an older server. The setup wizard's `install.sh`, the desktop updater and `npx skills add muitneliss/undercroft` still download from GitHub and still fail without access; they are not decided here.
