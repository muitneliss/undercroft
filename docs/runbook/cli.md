# The `undercroft` CLI

`undercroft` does from a terminal everything the web UI does, through the same `/trpc` API,
as the person who signed in. ADR 0044 records the decisions. This page is how to use it and
how to change it.

## Running it

| Where                        | Command                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| In this repo                 | `task dev:cli -- <command>`: builds the bundle, then runs it under `node`                                                |
| Anywhere, the newest release | `npm install -g https://github.com/muitneliss/undercroft/releases/latest/download/undercroft-cli.tgz`                    |
| Anywhere, one exact release  | `v=X.Y.Z; npm install -g "https://github.com/muitneliss/undercroft/releases/download/v$v/undercroft-cli-$v.tgz"`         |
| For an agent, via a skill    | `npx skills add muitneliss/undercroft --skill undercroft-cli [--agent claude-code\|codex] -y`, and the skill installs it |

It needs Node 22 or newer. `npm uninstall -g undercroft-cli` removes it.

Each release attaches the same tarball twice, as `undercroft-cli-X.Y.Z.tgz` and as
`undercroft-cli.tgz`. GitHub resolves `releases/latest/download/<name>` only for a name that
every release shares, so the unversioned copy is what gives "the newest release" one fixed
URL. `task cd:cli-upload` attaches both. ADR 0046.

The skill pins its release instead of taking the newest one, because its text documents one
release's commands and error codes. Before its first command, the agent runs
`undercroft --version`. It installs the pinned release when the CLI is missing, and asks the
person first when a different release is installed. When a global install is refused, it
runs the same pinned URL through `npx` instead.

The version is written ONCE, in `v`, because release-please's generic updater rewrites only
the first version on a line. The 1.20.0 release bumped the tag in the pinned URL and left the
tarball's name at 1.19.1, which is a 404. The README and `skills/undercroft-cli/SKILL.md`
both pin their line this way, and `scripts/skill.test.ts` fails when a pinned block holds more
than one version or a version other than the release's.

## First use, as a person

```sh
task dev:cli -- config set-profile local --url http://localhost:3000 --allow-writes
task dev:cli -- auth login              # asks for the email, then the code it sends
task dev:cli -- tenants list
task dev:cli -- runs list               # asks which tenant
task dev:cli -- describe runs.trigger   # one command, with the JSON Schema of its input
```

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
ever prompts. `skills/undercroft-cli/references/cli-contract.md` has the envelope, every error
code and every exit code.

Signing in takes two steps, because the code arrives in a person's inbox:

```sh
undercroft auth login --email ops@example.test --agent
undercroft auth login --email ops@example.test --code 123456 --agent
```

## Where things live

| What                | Where                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Profiles            | `$UNDERCROFT_CLI_HOME/config.json`, else `$XDG_CONFIG_HOME/undercroft`, else `~/.config/undercroft` |
| Sessions            | `credentials.json` beside it, mode 0600, keyed by origin                                            |
| A project's profile | `undercroft.cli.json` (`{ "profile": "local" }`) in the project or any parent                       |
| One-off server      | `--url` or `UNDERCROFT_URL`; never allows writes                                                    |

`config show` says which of these decided the current server, and whether a session exists.
It never prints the session itself.

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
  `session.signOut` for `auth`) goes through `callProcedure` in `handlers/remote.ts`, typed with
  the router's own input and query/mutation kind. Renaming or reshaping one fails the CLI's
  typecheck.
- **The gate** is `task ci:verify`, as everywhere. `apps/cli/src/cli.test.ts` builds the bundle
  into a temporary directory and runs it under `node` against `startControlPlane()` from
  `@undercroft/control-plane/testing`.
- **The package** is checked by `task ci:cli-pack-check`, which packs the tarball and runs it
  through `npx`. **The skill** is checked by `task ci:skill-check`, which needs the network.
- **A release** attaches the tarball on its own, under both names. The `release-cli` job in
  `release.yml` runs `task build:cli-pack`, then `task cd:cli-upload TAG=vX.Y.Z`.
  release-please bumps the version in `skills/undercroft-cli/SKILL.md`, `README.md` and
  `apps/cli/package.json` along with the root.

## When it goes wrong

| Symptom                                          | Cause                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_REQUIRED`                                | No `--profile`, `--url` or default profile, a profile that does not exist, or an unreadable config file. Run `config set-profile`. |
| `AUTHENTICATION_REQUIRED` right after signing in | A different origin: `localhost` and `127.0.0.1` are two. Check `config show`.                                                      |
| `WRITES_DISABLED`                                | The profile does not allow writes, or you used `--url`. A person turns it on at a terminal.                                        |
| `NETWORK_ERROR` against a URL that is up         | Nothing there answers `/trpc` as tRPC. Use the control plane's origin, or the Vite dev server that proxies to it.                  |
| No colour in human mode                          | `--no-color`, or `NO_COLOR` set in the environment.                                                                                |
| `npm install -g` fails with `EACCES`             | Node is installed system-wide. Use a Node you own (nvm, fnm, Homebrew) rather than `sudo`.                                         |
