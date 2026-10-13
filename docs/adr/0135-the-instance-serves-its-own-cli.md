# 135. The instance serves its own CLI

- Status: Accepted
- Date: 2026-10-13
- Supersedes: in part, [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md)'s
  "Distribution is a GitHub release asset, installed by the skill" and
  [ADR 0046](0046-the-cli-installs-once-from-the-latest-release.md)'s install lines, in where
  a person or an agent installs the CLI from. The release keeps attaching the tarball under both
  of ADR 0046's names.

## Context

Issue 465. The `undercroft` skill told an agent to install the CLI with
`npm install -g "https://github.com/muitneliss/undercroft/releases/download/v$v/undercroft-cli-$v.tgz"`,
and the CLI runbook gave the same URL and its `releases/latest/download` twin. The repository
was made private (ADR 0121), and from then on both URLs answered 404 to anyone who was not
signed in to GitHub with access to it. npm sends no GitHub credential, so they answer 404 to
those people too.

The person installing the CLI has a sign-in to an Undercroft server, not to the repository. And
the CLI they need is the one built from that server's commit: `apps/cli/scripts/build.ts` reads
the router's procedures at build time, so a CLI from another release lists commands the server
does not have, or misses ones it does. The skill pinned one release for that reason, and an
agent whose server ran a different release could only notice the mismatch, not fix it.

## Decision

**The control plane serves the CLI tarball of its own build at `GET /cli/undercroft-cli.tgz`,
and that is where the skill and the runbook install it from.**

1. **Built in the image, by the release's own script.** `deploy/Dockerfile.control-plane` has a
   stage `cli`, on top of the SPA stage's dev install, that runs `build:cli-pack`
   (`apps/cli/scripts/pack.ts`) and renames its output to one fixed name; the runtime stage
   copies it in and names it in `UNDERCROFT_CLI_TARBALL`. There is no second definition of how
   the tarball is made. The release job that attaches it to GitHub runs the same script.
2. **`bun pm pack`, not `npm pack`.** The image has Bun and no Node. Bun writes the same npm
   layout, and `task ci:cli-pack-check` installs and runs the result through `npx` exactly as
   before. Bun also stamps every entry with one fixed time, so a pack is reproducible.
3. **Read once at boot, served as given.** `cliTarball.ts` reads the named file into memory
   beside the image's other files (`imageFiles.ts`); a file that cannot be read is logged and
   the server boots without it. A process started from a checkout names none and serves none,
   rather than a tarball an earlier `task build:cli-pack` left in `apps/cli/dist`, which need
   not match it.
4. **Never the app shell.** Nothing under `/cli/` is a route of the browser's. A server with no
   tarball, or a name under `/cli/` other than the tarball's, answers 404 with a sentence in the
   caller's language. Left to the SPA's catch-all it would be a 200 of HTML, which npm reports
   as `TAR_BAD_ARCHIVE` -- a corrupt release, as far as the person can tell.
5. **No sign-in.** The tarball is served like the SPA's bundles. It is a client of `/trpc`: what
   it holds is each procedure's path, input schema and sentences, and the map from a tRPC code
   to the CLI's, all of which the SPA's bundle and `/trpc`'s own answers already show anyone who
   asks. It holds no secret and reaches nothing a request cannot. Behind a sign-in, npm
   would need a cookie it has no way to send, and the CLI exists to be the way in.
6. **The skill names the release it describes.** `skills/undercroft/references/cli.md` keeps a
   release-please block, now a sentence naming the release whose commands and codes it
   describes, rather than an install URL. An agent compares it with `undercroft --version`. The
   installed CLI always matches its server; the skill installed from GitHub may describe a newer
   release, and then the agent trusts `undercroft describe` over the file.
   `scripts/skills.test.ts` holds that block to exactly one version, the release's.

A server older than this release has no such route, so its SPA answers with HTML and npm
fails with `TAR_BAD_ARCHIVE`. The skill and the runbook tell a person with repository access to
download the release their server runs with `gh release download`, which signs in as them, and
to install that file.

## Options rejected

- **Publish `undercroft-cli` to the npm registry.** ADR 0046 set this aside, and it still has
  the cost it named, an npm credential in the release job. It also brings back the mismatch:
  the registry's newest version is not the server's.
- **Make the release assets public somewhere else, such as a public mirror repository or a
  bucket.** A second place to publish to and keep in step with every tag, for a file every
  server can already carry.
- **Serve it behind a sign-in.** See 5: npm cannot carry the session, and the CLI is how a
  person signs in from a terminal.
- **Pack it in the release job and pass it to the image build.** The image and the CLI are
  built by separate, parallel jobs, and the image build's context is the checkout. Handing a
  file from one to the other couples their timing, and a local `docker build` would need the
  pack first. Packing inside the image keeps the image self-contained.
- **Stream the file from disk on each request.** The tarball is a few hundred kilobytes; read
  at boot, the handler serves bytes it was given and never touches the filesystem, as
  `layering.md` asks of a handler.

## Consequences

- A person upgrades the CLI by running the same install line after the server is upgraded.
  Nothing tells them the server changed.
- A server holds its CLI in memory, about 200 KB.
- A server started from a checkout serves no CLI; `task dev:cli` is the way in there.
- The release still attaches the tarball, under both names. It is now what `gh`
  downloads for a server older than this release, not the install URL.
- Other things that download a GitHub release asset still fail for a person without access to
  the repository: the setup wizard's `install.sh`, the desktop app's updater, and
  `npx skills add muitneliss/undercroft`. They are not decided here.
