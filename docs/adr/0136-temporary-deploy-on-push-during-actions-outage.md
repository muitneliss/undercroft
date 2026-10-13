# 136. Deploy on push, built on the host, while GitHub Actions is out of minutes

- Status: Accepted
- Date: 2026-10-13
- Temporary: ends after GitHub Actions minutes reset on 2026-11-01; see Exit
- Amends: [ADR 0008](0008-deploy-on-release-from-ci.md) (only a release deploys, from CI) and
  [ADR 0049](0049-dokploy-clones-the-compose-file-from-main.md) (auto deploy off, the host never
  builds), with [ADR 0121](0121-dokploy-clones-the-private-repo-over-ssh.md)'s URL unchanged.
  Both stand again once this mode is switched off.

## Context

The organization's GitHub Actions minutes are used up until they reset on 2026-11-01. The
spending budget is $0, so usage is blocked rather than billed, and the repository is private, so
it has no free minutes of its own. Every workflow is blocked: `ci`, `release`, `build-images`,
`deploy`, `blog`, `desktop` and `visual`.

Under ADR 0008 and ADR 0049 that stops production entirely. A deploy is a release: release-please
cuts a tag, `build-images` publishes the images to ghcr, and `deploy` runs `preflight`, `deploy`,
`verify` and `smoke`. None of those can run. The server compose file is image-only, so the host
cannot run new code without an image some workflow published.

Turning the panel's auto deploy on alone would not help: a push would clone `main`, read the
same `ghcr.io/...:latest` tags, and restart the images it already has.

## Decision

Until the minutes reset, Dokploy deploys every push to `main` itself, **building the
first-party images on the host**:

- `deploy/compose/docker-compose.server.build.yml` is an override layered on the server file,
  never used alone. It gives `worker` and `control-plane` a `build:` from the clone, under local
  names (`undercroft-worker:main`, `undercroft-control-plane:main`, never a ghcr name), and points
  `db-migrate` and `kestra-flows` at the control-plane image with `pull_policy: never`, because
  compose builds every image before it creates a container. The base file, its memory limits,
  aliases and dependencies, is unchanged.
- The panel's stored command names both files and builds instead of pulling:
  `compose -p <project> --env-file deploy/compose/.env -f deploy/compose/docker-compose.server.yml -f deploy/compose/docker-compose.server.build.yml up -d --build --wait --wait-timeout 600 --remove-orphans`.
  It carries no `--pull`: that flag overrides every service's `pull_policy`, so
  `--pull missing` sent `db-migrate` and `kestra-flows` to Docker Hub for an image only the
  build produces (seen in a `docker compose --dry-run`, compose v5.1.2). Without it an upstream
  image is still pulled when missing, compose's default.
- `autoDeploy` is on, with `watchPaths` limited to what an image or the compose file is built
  from: `apps/**`, `packages/**`, `deploy/**`, `flows/**`, `specs/**`, `skills/**`,
  `package.json`, `bun.lock`. A GitHub push webhook posts to the panel's
  `/api/deploy/compose/<refreshToken>`.
- The seven workflows are disabled, so nothing queues runs that cannot start.

`task cd:outage-on` makes all four changes and `task cd:outage-off` undoes them, through
`scripts/dokploy.ts outage on|off`. They are the one place this repository writes the panel's
configuration, which ADR 0008 keeps out of CI. They are a person's tools, run from a terminal;
no workflow calls them. `outage off` ends by running `preflight`, so a switch back that left
anything behind fails while someone is watching, not on the next release day.

`preflight` itself is not relaxed. While the mode is on it is **expected to fail**: it refuses
`autoDeploy: true`, and the stored command lacks `--pull always` and names a second file. Its
refusal says that `task cd:outage-off` is the way back.

## Consequences

- **The host builds, on a machine shared with other projects.** Two image builds run on every
  deploy (8 cores, 22 GiB, about 10 GiB free at the time of writing). The build is outside the
  compose memory limits, which bind containers, not BuildKit. A build that starves a neighbour
  is the risk to watch, in `task cd:logs` and on the host.
- **No gate on a pull request.** `ci` does not run, so a merge is checked only by whoever runs
  `task ci:verify` locally before merging. Every push to `main` that touches a watched path goes
  to production.
- **No releases.** No tag, no CHANGELOG entry, no release-please PR, no images on ghcr. The
  version in `package.json` stays where it is, and the next release after the switch back
  carries everything merged meanwhile.
- **`task cd:verify` does not apply.** It compares the running digests with ghcr, and these
  images were never published there. `task cd:status`, `task cd:logs` and `task cd:smoke` are
  what a deploy is checked with. `--wait` still stops a crash-looping container from deploying
  green.
- **`UNDERCROFT_RELEASE` is blank.** No release names a build, so the Dockerfiles' `""` default
  stands and traces carry no `service.version` rather than a guessed one.
- **The blog, the desktop app and the CLI releases are paused.** Each is published by a
  workflow. The server still serves the CLI tarball its own image packs (ADR 0135).
- **The file and the code ship together.** Unlike a release, the host builds from the same
  commit it clones the compose file from, so ADR 0049's file-from-`main`, images-from-the-release
  mismatch cannot arise while this is on.
- **A rollback is a revert on `main`**, or the switch back and a redeploy of the last release
  (`task cd:outage-off`, then `task cd:release TAG=v1.76.0`).

## Options rejected

- **Auto deploy alone.** It clones `main` and restarts the images ghcr already serves; nothing
  new reaches the host.
- **Build and push the images from a laptop by hand.** It keeps the host from building, but the
  images come from whatever is checked out on someone's machine, with no record of which commit
  they are, and pushing to ghcr needs a write credential on that machine. The host building from
  the commit it cloned is at least reproducible from `main`.
- **A self-hosted runner.** It would run the workflows unchanged, but a private repository's
  runner executes the workflow code of every branch on a machine we keep, and setting one up and
  securing it costs more than the three weeks it would serve.
- **Paying for minutes.** The owner's choice not to; the reset is three weeks out.

## Exit

After the minutes reset on 2026-11-01:

1. `task cd:outage-off`. It restores the panel (auto deploy off, watch paths cleared, the
   release-only command), removes the push webhook, re-enables the workflows, and runs
   `preflight`, which must pass.
2. A pull request that deletes `deploy/compose/docker-compose.server.build.yml`, the `outage`
   section of `scripts/dokploy.ts` with its test and its two tasks, the runbook's "Actions
   outage mode" section and the pointer in `CLAUDE.md`, and adds an ADR that supersedes this
   one, recording that the mode has ended. This ADR is not edited; ADRs are immutable.
3. The release that PR produces is the first deploy back under ADR 0008.
