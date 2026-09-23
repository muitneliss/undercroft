# 46. The CLI installs once, from the latest release

- Status: Accepted
- Date: 2026-09-23
- Supersedes: the "Distribution is a GitHub release asset, installed by the skill" section of
  [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md), in how the CLI gets onto a
  machine. It keeps that section's decision that a release asset is the only place a version
  is published from.

## Decision

Each release attaches the packed CLI twice: as `undercroft-cli-X.Y.Z.tgz`, as before, and as
`undercroft-cli.tgz`. The two files hold the same bytes. `task cd:cli-upload` attaches both.

A person installs the CLI once with `npm install -g`. The README gives the newest release
through `releases/latest/download/undercroft-cli.tgz`, a URL with no version in it, and gives
the versioned URL for installing one exact release.

The skill still pins its release. It no longer runs every command through
`npx --package=<URL>`. Before its first command, the agent runs `undercroft --version`:

- When the CLI is missing, the agent installs the pinned release with `npm install -g`.
- When a different release is installed, the agent asks the person before replacing it.
- When the global install is refused, the agent runs the same pinned URL through `npx`, as
  ADR 0044 did.

## Why

The README's snippet under ADR 0044 asked a person to edit a version number, then define a
shell function that ran `npx` on every call. The function was gone in the next terminal, and
each call downloaded the package again whenever npm's cache no longer held it. A person used
to installing a CLI does not expect any of that.

GitHub resolves `releases/latest/download/<name>` to the asset of that name on the newest
release that is not a pre-release. That works only for a name every release shares, which
the versioned file never has. The unversioned copy gives "the newest CLI" one fixed URL. It
needs no registry, no token and no new place to publish from.

The skill keeps its pin because its text describes one release's commands and error codes. An
agent running a different release against those instructions would fail without saying why.

## Options rejected

- **Publish `undercroft` to the npm registry.** `npm install -g undercroft` is the most
  familiar install, and the name was unclaimed on 2026-09-23. It would reverse ADR 0044's one
  place of publication and add an npm token, or trusted publishing, to the release job. This
  is worth a later ADR of its own if the release asset turns out not to be enough.
- **Standalone binaries from `bun build --compile`, with a `curl | sh` installer.** They would
  drop the Node 22 requirement, but they need one build per platform and macOS notarization.
  Nobody has shown that the bundled oclif runs under Bun.
- **A Homebrew tap.** It adds a second repository to keep in step with every release.

## Consequences

- A person upgrades by running the install line again. Nothing tells them that a newer
  release exists.
- `npm install -g` writes to npm's global prefix. With a system-wide Node that needs `sudo`,
  which the runbook tells a person not to use and the skill forbids an agent.
- A release published before this ADR has no `undercroft-cli.tgz` until someone runs
  `task cd:cli-upload` for it again.
