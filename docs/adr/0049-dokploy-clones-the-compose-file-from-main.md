# 49. Dokploy clones the compose file from `main`

- Status: Accepted
- Date: 2026-09-24
- Amends: ADR 0008 (its context's "single raw-compose stack"; its decision is unchanged)

## Context

`deploy/compose/docker-compose.server.yml` was called the source of truth, but the panel
never read it. The compose was a Dokploy **raw** source: the panel held a pasted copy, and a
deploy ran that copy. Keeping them equal was a person's job, done by hand after every change
to the file.

That job was missed twice. The first time the copy drifted until it ran a service this repo
had deleted (Metabase, ADR 0020) and lacked a `depends_on`, and three releases failed at
`--wait`. `preflight` then learnt to compare the copy with the file line for line. The second
time that comparison did its job: #173 added two variables to the file, nobody pasted it,
and the v1.26.0 deploy stopped at `preflight` until someone pushed the file by hand. The
check made the drift visible but did not remove it: every change to the file still needed a
manual step, and every missed step still failed a release.

The raw source was never a decision. ADR 0008 describes the stack as raw compose in its
context and weighs only how to trigger a deploy, not where the file comes from.

## Decision

The panel's compose source is **`git`**: `https://github.com/muitneliss/undercroft.git`, branch
`main`, compose path `deploy/compose/docker-compose.server.yml`, **auto deploy off**. Every
deploy clones `main` (`git clone --branch main --depth 1`, Dokploy v0.30.6) and runs the file
from the clone. The panel holds no copy, so there is nothing to drift and nothing to push:
merging a change to the file is the whole rollout, and the next release runs it.

The stored command names the file's own paths, because Dokploy runs it from the clone's root
and writes `.env` beside the compose file:

```
compose -p undercroft-aypcjn --env-file deploy/compose/.env -f deploy/compose/docker-compose.server.yml up -d --pull always --wait --wait-timeout 600 --remove-orphans
```

`preflight` stops comparing a copy. Before anything is queued it asserts:

1. the source is `git` at that URL, branch and path, with `autoDeploy` false;
2. the file on `main`, read through GitHub's contents API, is byte for byte the file in the
   checkout being deployed (line endings and trailing blank lines forgiven);
3. the file names published images, and the command carries the flags above.

`verify` reads the checkout's file for the services to check, never the panel's
`composeFile` field, which under a git source is a stale paste that nothing deploys.

CI still never writes the panel's configuration (ADR 0008). The source settings are set once,
by a person, through `compose.update` with only those fields — never `env`, which replaces the
whole credential blob.

## Consequences

- **The file ships from `main`, the images from the release.** The host clones `main`'s head
  at deploy time, not the release's commit. A change to the file merged while a release's
  images were building would ship beside images that predate it; check 2 refuses that deploy,
  and the next release carries the change with its own images.
- **A rollback moves the images, not the file.** `IMAGE_TAG=vX.Y.Z` still pins the images,
  but the host runs `main`'s file. That is harmless while the file only gains what older
  images ignore; a change they cannot run has to be reverted on `main` too. The runbook's
  rollback section says so.
- **The host now has a checkout, and nothing uses it for code.** The first-party services
  stay on published images and the Kestra flows stay baked into the control-plane image:
  both are what a release fixes and `verify` proves by digest, and `main` is neither.
- **GitHub is on the deploy path.** A clone that fails stops the deploy on the host, and a
  contents API that fails stops `preflight`. Both fail closed, before or without replacing
  a running container.
- **The repository must stay public**, or the source needs a deploy key
  (`customGitSSHKeyId`) or a GitHub provider instead of a plain URL.

## Options rejected

- **Keep the raw copy and push it from CI after merge.** It removes the manual step but makes
  CI a writer of the panel's configuration, which ADR 0008 rules out, and it still leaves two
  copies to compare.
- **Keep the raw copy and a stricter check.** That is what failed v1.26.0: the check was
  right, and the release still needed a person.
- **Clone the release tag instead of `main`.** It would ship file and images from one commit,
  and a rollback would move both. But the tag changes every release, so either CI writes it
  into the panel (ruled out above) or a person does, which is the manual step again.
- **A GitHub provider source (`sourceType: github`).** It works, but it needs a GitHub App
  installed on the repository for a repository anyone can clone, and its push webhook is one
  more way to trigger a deploy that ADR 0008 says only a release may start.
