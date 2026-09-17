---
paths:
  - "deploy/**"
  - "flows/**"
---

# Deployment: one channel, explicit limits

We are a tenant on a shared host running eleven other projects. Two failure
modes matter here: drifting from Dokploy's recorded state, and starving a
neighbour's service. Both are invisible from inside this repo, which is why
they are rules rather than habits.

## NEVER

- **NEVER edit anything directly on the server.** Direct edits bypass Dokploy's
  state and cause drift — the deployed thing stops matching what Dokploy
  believes it deployed, and the next deploy silently reverts your fix.
- **NEVER invent a Dokploy endpoint name.** Fetch `settings.getOpenApiDocument`
  and search it. A plausible-looking endpoint that does not exist fails in a way
  that reads like a permissions problem and costs an hour.
- **NEVER add a service with no memory limit.**

## Follow

- **The Dokploy API is the only channel for changes**, via the `dokploy` skill
  against `https://lowbit.link/api`.
- **SSH is read-only, for diagnosis.** Read logs, inspect state, confirm a
  hypothesis — then make the change through the API.
- **Every service carries an explicit memory limit.** See ADR 0001 for the
  measured capacity of this host.
- **`deploy/compose/` in this repo is the source of truth;** Dokploy holds a
  copy. Services deploy as raw compose. Change the file here first.
- **The whole platform is one `docker compose up`.** There is no ingestion
  platform, no Airbyte, no Meltano, no Kubernetes. One `worker` container does
  everything and `dlt` is a library inside it, not a service. Scheduling is
  Kestra. See ADR 0003 before adding any component that assumes otherwise.

`flows/` is the Kestra flow directory. It is empty today; this rule covers it
from the first file so the constraints are not retrofitted after the fact.
