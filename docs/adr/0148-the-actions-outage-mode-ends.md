# 148. The Actions outage mode ends

- Status: Accepted
- Date: 2026-10-20
- Supersedes: [ADR 0136](0136-temporary-deploy-on-push-during-actions-outage.md), the temporary
  mode in which Dokploy built and deployed every push to `main` while GitHub Actions had no
  minutes.
- [ADR 0008](0008-deploy-on-release-from-ci.md) (only a release deploys, from CI) and
  [ADR 0049](0049-dokploy-clones-the-compose-file-from-main.md) (auto deploy off, the host never
  builds) stand again in full, with [ADR 0121](0121-dokploy-clones-the-private-repo-over-ssh.md)'s
  URL unchanged.

## Context

ADR 0136 was to end after the Actions minutes reset on 2026-11-01. It ended earlier, on
2026-10-20: `muitneliss/undercroft` was made public again, and a public repository's workflows
run free on GitHub's standard hosted runners. Every workflow here runs on one (`ubuntu-24.04`,
`macos-15`, or a matrix of them), so nothing waits for the reset.

The first step of ADR 0136's Exit ran the same day. `task cd:outage-off` turned auto deploy off,
cleared the watch paths, put back the release-only command, removed the push webhook and
re-enabled the workflows, and its closing `preflight` passed.

## Decision

**The mode is over, and the code that ran it is gone.** This is step 2 of ADR 0136's Exit:

- `deploy/compose/docker-compose.server.build.yml`, the override that built `worker` and
  `control-plane` on the host.
- The `outage` section of `scripts/dokploy.ts` (`outage on|off`, the `gh` client it drove, its
  watch paths and `storedCommand`, which only the switch called), the `refreshToken` it read off
  the panel, and the hint `preflight` gave while the mode was on. Its test went with it.
- The tasks `cd:outage-on` and `cd:outage-off`.
- The runbook's "Actions outage mode" section with its pointers, and the paragraph in
  `CLAUDE.md` that suspended the deploy rules.

ADR 0136 is not edited; it records what was done while it was in force.

## Consequences

- **The release this pull request produces is the first deploy back under ADR 0008**: tag,
  `build-images`, then `deploy.yml`'s `preflight`, `deploy`, `verify` and `smoke`.
- **Until then, a redeploy that does not build images first rolls production back.** While the
  mode was on, production ran images the host built from `main`, last deployed on 2026-10-18.
  The newest `:latest` images on ghcr are from 2026-09-17, so `task cd:deploy` or
  `task cd:release` run by hand before the release would pull those and run code a month old.
  The release workflow builds and publishes images before it deploys, so the release is the safe
  way back. For the same reason `task cd:verify` cannot pass before it: the running containers
  are not images ghcr serves.

## Rejected

- **Keep the mode in the tree, switched off, for the next outage.** A public repository does not
  run out of minutes on standard runners, and code with no caller drifts from the panel it
  writes to. ADR 0136 and its pull request record how it worked if it is ever needed again.
- **Wait for 2026-11-01 as ADR 0136 planned.** The reason for the mode is already gone, and every
  day it stays in the tree is a day `CLAUDE.md` tells an agent the deploy rules are suspended.
