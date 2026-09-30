# 95. Undercroft installs through a setup wizard that drives Docker

- Status: Accepted
- Date: 2026-09-30
- Related: [ADR 0094](0094-a-local-install-signs-its-owner-in-on-loopback.md) (how a desktop
  install signs its owner in), [ADR 0046](0046-the-cli-installs-once-from-the-latest-release.md)
  (the release channel), [ADR 0049](0049-dokploy-clones-the-compose-file-from-main.md) (the
  server compose file this one is derived from).

## Decision

A person installs Undercroft on Windows, macOS or Linux by running one program, the setup
wizard. It installs the same compose stack the server runs, pulled from ghcr at a pinned
release, and nothing else.

- **One setup service, two front ends.** `packages/setup` owns every install decision: whether
  Docker is ready, how to install it on this platform, the secrets, the `.env`, the compose
  file, pulling, starting, waiting for health, status, stopping and uninstalling. It reads no
  environment, writes to no terminal and words no sentence. It receives a process runner, a
  folder, `fetch` and a clock, and returns values and problem codes. `apps/installer-cli` is
  the terminal wizard over it, built with Clack, Vietnamese first. A GUI wizard built with
  Electrobun comes next and drives the same service.
- **Two modes.** A _desktop_ install is for one person. It is published on 127.0.0.1 only,
  opened at `http://localhost:<port>`, and signs its owner in as `owner@undercroft.local`, the
  one superadmin (ADR 0094). A _server_ install is for a team. It needs an https public URL, an
  administrator's address and a sign-in method that proves an address, either a Resend key or
  a Google client. The control plane is published on a port for the operator's own reverse
  proxy.
- **The compose file is the server's, minus Dokploy.**
  `deploy/compose/docker-compose.install.yml` drops `dokploy-network`, publishes the control
  plane alone, requires `IMAGE_TAG`, and passes `UNDERCROFT_DEV_SIGN_IN_AS` through. A test
  fails the gate when its services or images drift from the server file. The installer embeds
  the file at build time, so the installer of release vX.Y.Z writes that release's compose file
  beside that release's images. Starting an install always moves it to the installer's own
  release, so the file and the images never come from two releases.
- **Secrets are made on the machine and never remade.** Every secret is generated from the
  operating system's CSPRNG when the install is first written. A re-run keeps each one, and
  every line a person added, and changes only what the answers decide. A folder with no `.env`
  beside an earlier install's Postgres volume is refused as `orphaned-data`, because new
  secrets could not open the data that is still there.
- **Distribution is the release.** Each release attaches one executable per platform, built
  with `bun build --compile`, under names every release shares, plus
  `undercroft-installer-SHA256SUMS` and `install.sh`. The script checks the download against
  the checksums before it runs it. No secret and no OAuth client ships in the binary; a person
  pastes their own Google or Xero client, and HubSpot needs none.

## Why

The platform is a lot of processes: Postgres with roles and row-level security, PgBouncer,
MinIO, Kestra on a JVM, a worker that runs dbt and poppler, and the control plane. Docker
Compose already runs exactly that on the server, with limits and healthchecks that each record
a failure. A desktop install that ran something else would be a second platform to keep
working. Docker is the one prerequisite, and the wizard offers to install it.

The hard part of an install is ours in any packaging: which secrets exist, which must never be
regenerated, which variables each mode sets, and what to do when the data outlives its `.env`.
Putting that in one service below any UI means the terminal wizard, the GUI and an unattended
`--yes` run cannot disagree about it.

## Options rejected

- **Re-bundling Postgres, dbt, MinIO and Kestra natively.** Too much for too little. Four
  runtimes, one of them Python, each packaged per operating system and kept current. PGlite,
  the embedded Postgres, has no roles or RLS and no wire protocol, so the grant model
  (ADR 0005, ADR 0018) and dbt could not run on it.
- **Tauri for the GUI.** It needs a Rust shell, and this repository is TypeScript only.
  Electrobun gives the GUI a Bun main process that imports `packages/setup` as it is.
- **Qt Installer Framework, InstallBuilder, InstallAware.** Each is a second UI stack, and two
  are commercial. A classic installer copies files and writes shortcuts. Here the real work is
  the Docker orchestration, which we would still write ourselves, so it would sit behind a
  script hook in someone else's wizard.
- **NSIS or Inno Setup.** Windows only, and the same objection as above.

## Consequences

- An install needs Docker, and the stack's memory limits add up to about 8 GB across the
  long-running services. They are ceilings, not reservations, and an idle stack uses a
  fraction of them. The runbook asks for at least 8 GB for Docker Desktop.
- Docker Desktop is free for individuals and small businesses. A company with more than 250
  employees, or more than USD 10 million in revenue, needs a paid Docker subscription. The
  wizard says so before it installs Docker. On Linux, Docker Engine has no such licence.
- The installer binaries are not code-signed. `install.sh` downloads with curl, which does not
  set macOS's quarantine flag, and verifies a checksum. A binary downloaded in a browser may
  meet Gatekeeper or SmartScreen, and the runbook says what to do.
- Kestra is the heaviest service on a laptop. Replacing it with a lighter scheduler is a
  follow-up with its own ADR. So is automatic TLS for a server install through Caddy. Until
  then the operator brings the reverse proxy.
- `update` moves an install to the installer's release, or to `--tag`. The compose file is
  always the installer's own, so `--tag` to an older release is a rollback that runs an older
  image under a newer file. The runbook marks it as the escape hatch it is.
