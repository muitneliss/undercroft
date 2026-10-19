---
title: ADR 0148 The Actions Outage Mode Ends
type: source
date: 2026-10-19
tags: []
source: docs/adr/0148-the-actions-outage-mode-ends.md
source_path: docs/adr/0148-the-actions-outage-mode-ends.md
source_hash: 912f35a93750bc2da03aea30b9c6cee429f970fd5ff10e9903841f4697bc2cd9
ingested: 2026-10-19
---

# ADR 0148 The Actions Outage Mode Ends

Supersedes [[ADR 0136 Deploy on Push, Built on the Host, While GitHub Actions Is Out of Minutes]]. [[ADR 0008 Deploy on Release from CI]] (only a release deploys, from CI) and [[ADR 0049: Dokploy clones the compose file from main]] (auto deploy off, the host never builds) stand again in full, with [[ADR 0121 Dokploy Clones the Private Repository over SSH, with a Read-Only Deploy Key]]'s URL unchanged.

**Why.** ADR 0136 was to end after the Actions minutes reset on 2026-11-01. It ended on 2026-10-20 instead: `muitneliss/undercroft` was made public again, and a public repository's workflows run free on GitHub's standard hosted runners, which every workflow here uses (`ubuntu-24.04`, `macos-15`, or a matrix of them). Step 1 of ADR 0136's Exit ran the same day: `task cd:outage-off` turned auto deploy off, cleared the watch paths, restored the release-only command, removed the push webhook, re-enabled the workflows, and its closing `preflight` passed.

**Decision.** Step 2 of the Exit: the code that ran the mode is deleted -- `deploy/compose/docker-compose.server.build.yml` (the override that built `worker` and `control-plane` on the host); the `outage` section of `scripts/dokploy.ts` (`outage on|off`, its `gh` client, watch paths and `storedCommand`, the `refreshToken` it read, and `preflight`'s outage hint) with its test; the tasks `cd:outage-on` and `cd:outage-off`; the runbook's "Actions outage mode" section and the `CLAUDE.md` paragraph that suspended the deploy rules. ADR 0136 is not edited.

**Consequences.** The release this change produces is the first deploy back under ADR 0008: tag, `build-images`, then `deploy.yml`'s `preflight`, `deploy`, `verify` and `smoke`. Until then a redeploy that does not build images first rolls production back: production ran host-built images of `main` (last deployed 2026-10-18) while the newest ghcr `:latest` images date from 2026-09-17, so `task cd:deploy` or `task cd:release` by hand would run month-old code; for the same reason `task cd:verify` cannot pass before the release.

**Rejected.** Keeping the switch in the tree for a next outage (a public repository does not run out of minutes on standard runners, and code with no caller drifts from the panel it writes to); waiting for 2026-11-01 (the cause is gone, and meanwhile `CLAUDE.md` would tell agents the deploy rules are suspended).
