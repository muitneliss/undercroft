# The `undercroft` CLI

`undercroft` does from a terminal everything the web UI does, through the same `/trpc` API,
as the person who signed in. ADR 0044 records the decisions, and ADR 0134 signing in with a
personal access token. This page is how to use it and how to change it.

## Running it

| Where                          | Command                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| In this repo                   | `task dev:cli -- <command>`: builds the bundle, then runs it under `node`                                                                        |
| From the server you sign in to | `npm install -g https://<your Undercroft>/cli/undercroft-cli.tgz`                                                                                |
| One exact release, from GitHub | `gh release download vX.Y.Z --repo muitneliss/undercroft --pattern 'undercroft-cli-X.Y.Z.tgz'`, then `npm install -g ./undercroft-cli-X.Y.Z.tgz` |
| For an agent, via a skill      | `npx skills add muitneliss/undercroft --skill undercroft [--agent claude-code\|codex] -y`, and the skill installs it                             |

It needs Node 22 or newer. `npm uninstall -g undercroft-cli` removes it.

Every server serves the CLI of its own build at `/cli/undercroft-cli.tgz`, with no sign-in, so
the CLI you install from it lists exactly the commands that server has. Run the line again
after the server is upgraded. ADR 0135.

A server answers that URL with a 404 when it carries no CLI: one started from a checkout
(`task dev:run`), where `task dev:cli` is the way in. A server whose release is older than the
first to serve one answers with its web page instead, and npm fails with `TAR_BAD_ARCHIVE`.
For either, with access to the repository, install the release the server runs from GitHub, as
in the table: the release is printed at the foot of every page and on the sign-in page. The
repository is private (ADR 0121), so a GitHub release URL given straight to npm is a 404 even to
someone who can read it; `gh` downloads it with your own sign-in.

The image packs the tarball in its own build with `apps/cli/scripts/pack.ts`, the script behind
`task build:cli-pack` and so the same one that packs the file each release attaches, and names
it in `UNDERCROFT_CLI_TARBALL`. A server with that unset serves no CLI, even when a tarball from an
earlier pack is lying in `apps/cli/dist/`, because that one need not match it.

The skill installs the CLI from the person's server too. Before its first command, the agent
runs `undercroft --version` and compares it with the release
`skills/undercroft/references/cli.md` says it describes. It installs the CLI when it is
missing, and asks the person first when a different release is installed. When a global
install is refused, it runs the same URL through `npx` instead.

That release is written ONCE in the file's pinned block, because release-please's generic
updater rewrites only the first version on a line: the 1.20.0 release, when the block was a
GitHub URL, bumped the tag and left the tarball's name at 1.19.1, which is a 404.
`scripts/skills.test.ts` fails when the pinned block holds more than one version or a version
other than the release's. The README pins nothing; it links here.

## First use, as a person

```sh
task dev:cli -- config set-profile local --url http://localhost:3000 --allow-writes
task dev:cli -- auth login              # asks for the email, then the code it sends
task dev:cli -- tenants list
task dev:cli -- runs list               # asks which tenant
task dev:cli -- describe runs.trigger   # one command, with the JSON Schema of its input
```

Against a deployed server, run the installed `undercroft` instead of `task dev:cli --`, and
leave writes off until you mean to change something:

```sh
undercroft config set-profile prod --url https://undercroft.example.test
undercroft auth login                    # the same emailed code as the web sign-in
undercroft runs list                     # asks which customer
undercroft config set-profile prod --allow-writes   # only when you mean it, at your own terminal
```

On an install the setup wizard made for one person (a desktop install, served at
`http://localhost:<port>`), there is no email and no code. `auth login` asks the server which
ways in it offers. When the only one is signing in on this machine, it does that and keeps the
session as it keeps any other. It needs no flag, and works the same with `--agent`:

```sh
undercroft config set-profile local --url http://localhost:13000
undercroft auth login                    # signed in as the install's owner, no code
undercroft config set-profile local --allow-writes  # only when you mean it, as anywhere
```

On a developer's stack that also offers the emailed code, `auth login --local` chooses this way
in. It works only for a server on this machine, and only at the exact address the install
prints: `localhost` and `127.0.0.1` are two addresses, and the server refuses the other one.
Signing in this way never turns on writes. [ADR 0096](../adr/0096-the-cli-signs-in-to-a-local-install-the-way-the-browser-does.md).

`undercroft` on its own, at a terminal, is the home page: the title page with the sign-in form
on it while you are signed out, and the contents page (every topic and how many commands it
has) once you are in. A rejected code offers a new one instead of ending the run. A piped run
still prints the help. The frames are in `docs/design/cli-home-and-sign-in.md`.

`--allow-writes` can be set only here, at a terminal. An agent that tries it gets
`HUMAN_REQUIRED`. Use a separate profile per environment, for example `local`, `staging`
and `prod`. The first profile you write becomes the default, and `config use <name>` changes
it. A session is kept per origin, so logging in to one never signs you in to another;
`auth status` says whether you have one and `auth logout` ends it.

`--no-input` never prompts, even at a terminal: a missing argument is refused, and a
destructive command needs `--yes`. `--quiet` prints less.

## As an agent

Pass `--agent`. Agent mode is also inferred whenever stdin or stdout is not a terminal. In
agent mode, stdout holds exactly one JSON envelope and the exit code agrees with it; nothing
ever prompts. `skills/undercroft/references/cli.md` has the envelope, every error code and
every exit code. The `undercroft` skill, and the workflow skills beside it, teach an agent
when to use which command; [agent skills](agent-skills.md) covers installing them.

Signing in takes two steps, because the code arrives in a person's inbox:

```sh
undercroft auth login --email ops@example.test --agent
undercroft auth login --email ops@example.test --code 123456 --agent
```

On a desktop install it takes one, `undercroft auth login --agent`, with no address.

## Unattended, with a personal access token

A script, a CI job or an agent with nobody at its terminal cannot read an emailed code. It
signs in with a personal access token instead: the person mints one on the web UI's Account
page, with a `read` or `write` grant and an expiry, and puts it in an environment variable the
job is given, such as a CI secret. `auth login` takes the variable's **name**, never the token:

```sh
export UNDERCROFT_TOKEN=…            # from your secret store, never typed into a command
undercroft config set-profile ci --url https://undercroft.example.test
undercroft auth login --token-env UNDERCROFT_TOKEN --agent
undercroft runs list --tenant-id CASE-0042 --agent
```

`auth login` proves the token by asking the server who it belongs to, then keeps the name of
the variable and that address under the server's origin. Every later command reads the
variable again and sends the token as `Authorization: Bearer`. So the token is in no file, no
argument list and no output, rotating it is changing the variable, and revoking it on the
Account page stops the next command.

The token is the person's own, and reaches what they reach. Its grant binds on the server: a
`read` token is refused any command that is not a read, `lake query` and `models preview`
included, with `PERMISSION_DENIED` naming `needs: "write"`. A profile's `allowWrites` still
applies first, so a `write` token writes only through a profile a person allowed writes on. A
token cannot reach the token procedures (`account tokens …`), so it cannot mint a wider one.

`auth status` reports `signedInWith: "token"` and the variable's name. `auth logout` forgets
the variable; it does not revoke the token, which works until it expires or is revoked on the
Account page.

To save every row of a saved question, a definition or a dbt model to a file, ask for an export
and download its link with the same session (ADR 0111):

```sh
undercroft bi exports create --tenant-id CASE-0042 \
  --input-json '{"source":{"kind":"model","model":"fct_revenue"}}' --agent
undercroft bi exports download <url> --out revenue.csv --agent
```

The link lives 15 minutes. A download that is cut writes no file, and a link to a server other
than the profile's is refused before the session is sent.

## Where things live

| What                | Where                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Profiles            | `$UNDERCROFT_CLI_HOME/config.json`, else `$XDG_CONFIG_HOME/undercroft`, else `~/.config/undercroft` |
| Sessions            | `credentials.json` beside it, mode 0600, keyed by origin                                            |
| A token sign-in     | the same file holds the variable's name and the address, never the token                            |
| A project's profile | `undercroft.cli.json` (`{ "profile": "local" }`) in the project or any parent                       |
| One-off server      | `--url` or `UNDERCROFT_URL`; never allows writes                                                    |

`config show` says which of these decided the current server, whether you are signed in, and
whether with a session or a token (and which variable holds it). It never prints the session or
the token itself.

## Changing it

- **A new procedure** needs nothing in the CLI. It needs a sentence in both
  `apps/control-plane/src/i18n/procedures.vi.ts` and `procedures.en.ts`, keyed by its dotted
  path, and a new mutation also needs its effect in `EFFECTS`
  (`apps/control-plane/src/handlers/surface.ts`). A new router namespace also needs a sentence
  under `topics` in `apps/cli/src/i18n/vi.ts` and `en.ts`. Each of those tables is typed
  against the router, so `task ci:typecheck` names what is missing, and names every entry a
  renamed or deleted procedure left behind. What the compiler cannot see, the build
  (`task build:cli`) refuses: an input property may not share a global flag's name (`profile`,
  `url`, `yes` and the rest).
- **A procedure the CLI calls by name** (`tenants.list` for the tenant prompt, `session.me` and
  `session.signOut` for `auth`, `config.signIn` to learn the ways in) goes through `callProcedure` in `handlers/remote.ts`, typed with
  the router's own input and query/mutation kind. Renaming or reshaping one fails the CLI's
  typecheck.
- **The gate** is `task ci:verify`, as everywhere. `apps/cli/src/cli.test.ts` builds the bundle
  into a temporary directory and runs it under `node` against `startControlPlane()` from
  `@undercroft/control-plane/testing`.
- **The package** is checked by `task ci:cli-pack-check`, which packs the tarball and runs it
  through `npx`. **The skill** is checked by `task ci:skill-check`, which needs the network.
- **A release** carries the tarball twice. The control plane's image packs it in its own
  build stage and serves it at `/cli/undercroft-cli.tgz` (`deploy/Dockerfile.control-plane`).
  The `release-cli` job in `release.yml` runs `task build:cli-pack`, then
  `task cd:cli-upload TAG=vX.Y.Z`, which attaches it to the release under both names.
  release-please bumps the version in `skills/undercroft/references/cli.md` and
  `apps/cli/package.json` along with the root.

## When it goes wrong

| Symptom                                                    | Cause                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_REQUIRED`                                          | No `--profile`, `--url` or default profile, a profile that does not exist, or an unreadable config file. Run `config set-profile`.        |
| `AUTHENTICATION_REQUIRED` right after signing in           | A different origin: `localhost` and `127.0.0.1` are two. Check `config show`.                                                             |
| `WRITES_DISABLED`                                          | The profile does not allow writes, or you used `--url`. A person turns it on at a terminal.                                               |
| `PERMISSION_DENIED` from `auth login` on a desktop install | The profile says `127.0.0.1` and the install is at `localhost`, or the other way round. The message names the address to use.             |
| `INVALID_ARGUMENT` from `auth login --local`               | The URL is not on this machine. Signing in without a code works only on loopback; use `--email`.                                          |
| `auth login` asks for an email on a desktop install        | The server offers the emailed code as well, or is too old to say what it offers. Pass `--local`.                                          |
| `CONFLICT` with `TENANT_DEACTIVATED` in its details        | An admin deactivated the customer. Every command on it is refused until an admin reactivates it, on the web or with `tenants reactivate`. |
| `AUTHENTICATION_REQUIRED` naming a variable that is unset  | Signed in with `--token-env`, and this process was not given the variable. Set it for the job.                                            |
| `AUTHENTICATION_REQUIRED` saying the token was refused     | The token was revoked, expired, or its person lost access. Mint a new one on the Account page and put it in the same variable.            |
| `PERMISSION_DENIED` with `needs: "write"` in its details   | The token holds the `read` grant. Mint a `write` token if this job is meant to change anything.                                           |
| `INVALID_ARGUMENT` from `auth login --token-env`           | The value is not a variable's name, most likely the token itself. Pass the name of the variable that holds it.                            |
| `NETWORK_ERROR` against a URL that is up                   | Nothing there answers `/trpc` as tRPC. Use the control plane's origin, or the Vite dev server that proxies to it.                         |
| `npm install` from a server fails with `404` or `TAR_BAD_ARCHIVE` | The server serves no CLI: it was started from a checkout, or its release is older than the first to serve one. Install that release from GitHub, as under Running it. |
| No colour in human mode                                    | `--no-color`, or `NO_COLOR` set in the environment.                                                                                       |
| `npm install -g` fails with `EACCES`                       | Node is installed system-wide. Use a Node you own (nvm, fnm, Homebrew) rather than `sudo`.                                                |
