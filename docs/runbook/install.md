# Installing Undercroft

The setup wizard installs Undercroft on Windows, macOS or Linux, on a laptop for one person or
on a server for a team. It installs the same Docker compose stack the hosted server runs,
pulled at one pinned release. [ADR 0095](../adr/0095-undercroft-installs-through-a-setup-wizard-that-drives-docker.md)
records why. This page is how to install, operate, back up and remove it.

## Before you start

| You need      | Why                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docker        | Undercroft runs in Docker. The wizard offers to install it: winget on Windows, Homebrew or a download on macOS, Docker's `get.docker.com` script on Linux.                                                                     |
| Memory        | At least 8 GB given to Docker, and 16 GB of RAM in the machine is comfortable. The services' limits total about 8 GB. They are ceilings, and an idle stack uses much less. In Docker Desktop: _Settings > Resources > Memory_. |
| Disk          | About 15 GB for the images, plus your data.                                                                                                                                                                                    |
| The network   | Only for the first start, and for `update`: images come from ghcr.io and Docker Hub.                                                                                                                                           |
| A server only | A domain with https in front of it (Caddy, nginx, Traefik), and a way to sign in: a [Resend](https://resend.com) API key or a Google sign-in client. [Sign-in setup](sign-in-setup.md) covers both.                            |

**Docker Desktop's licence.** Docker Desktop is free for individuals, education and small
businesses. A company with more than 250 employees, or more than USD 10 million in annual
revenue, needs a paid Docker subscription. Docker Engine on Linux has no such licence.

## Install

### macOS and Linux

```sh
curl -fsSL https://github.com/muitneliss/undercroft/releases/latest/download/install.sh | sh
```

The script downloads the wizard for your machine, checks it against the release's
`undercroft-installer-SHA256SUMS`, keeps it as `~/.local/bin/undercroft-installer`, and runs
it. `UNDERCROFT_VERSION=vX.Y.Z` installs one exact release, and `UNDERCROFT_BIN_DIR` puts the
program somewhere else.

### Windows

Download `undercroft-installer-windows-x64.exe` from the
[latest release](https://github.com/muitneliss/undercroft/releases/latest) and double-click
it. The binary is not code-signed yet, so SmartScreen may say it does not recognise the app:
choose _More info > Run anyway_. The window stays open at the end until you press Enter.

### What the wizard asks

1. **Language.** Tiếng Việt or English.
2. **Who it is for.**
   - _Just me, on this machine._ This is the desktop mode. Undercroft opens at
     `http://localhost:13000`, and you are signed in as its owner, `owner@undercroft.local`,
     with no email and no password. The port is published on 127.0.0.1 only, so nothing else
     on your network can reach it. [ADR 0094](../adr/0094-a-local-install-signs-its-owner-in-on-loopback.md) covers how that sign-in is kept to this
     machine.
   - _A team, on a server._ This is the server mode. The wizard asks for the https address
     people will use, the first administrator's email, and how people sign in.
3. **Docker.** It checks that Docker is installed and running, and offers to install or open
   it.
4. **Settings.** The port, and on a server the address, the administrator, the sign-in method
   and the address to publish on.
5. **More data sources.** Gmail and Google Drive, or Xero, each with a client you register
   yourself: [Google ingestion](google-ingestion-setup.md), [Xero](xero-setup.md). HubSpot needs
   nothing here, because each customer pastes its own token.
6. **Install.** It writes the settings, pulls the images, starts the services and waits until
   Undercroft answers. The first start takes a few minutes. On a desktop it then opens your
   browser.

At the end it prints any redirect URIs you need to register with Google or Xero.

**Open the address it prints, exactly.** A desktop install is `http://localhost:<port>`. The
owner's sign-in works only at that origin. At `http://127.0.0.1:<port>` the page refuses it and
says where to go instead (ADR 0094).

### On a server

The control plane is published on `127.0.0.1:<port>` unless you give another address to
publish on, and it speaks plain http. Put your reverse proxy in front of it, terminating TLS
for the public address you gave. With Caddy, for example:

```
data.example.test {
    reverse_proxy 127.0.0.1:13000
}
```

The administrator signs in at the public address and invites everyone else. Automatic TLS in
the stack itself is a planned follow-up.

### Without questions

Every answer is also a flag, for a script or a provisioning tool. `--yes` asks nothing and
never installs Docker.

```sh
undercroft-installer --yes --mode desktop
undercroft-installer --yes --mode server \
  --public-url https://data.example.test --admin you@example.test \
  --email-api-key re_... --email-from "Undercroft <no-reply@example.test>"
```

`--dry-run` prints what would be installed and stops, without writing a file or calling
Docker. `undercroft-installer --help` lists every flag. A flag given on a re-run changes that
one answer and keeps the rest.

## Where things are

| What                 | Where                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| The install folder   | `~/.undercroft` on macOS and Linux, `%LOCALAPPDATA%\Undercroft` on Windows, or `--dir`               |
| Settings and secrets | `.env` in that folder, readable by you alone                                                         |
| The compose file     | `docker-compose.yml` in that folder, written by the wizard. Do not edit it: the next run replaces it |
| The data             | Docker volumes named `undercroft-install_*`                                                          |

One machine holds one install: its containers and volumes are named `undercroft-install`,
whatever `--dir` says.

You may add lines to `.env`, such as an assistant key ([the assistant](assistant-setup.md)) or
a Lark webhook. Re-running the wizard keeps every line it did not ask about, and never
replaces a password or a key that is already there.

## Operating it

| Command                               | Does                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `undercroft-installer`                | Start the install, or change its settings. The same as `up`               |
| `undercroft-installer status`         | Each service's state                                                      |
| `undercroft-installer logs [service]` | Follow the log. `control-plane` and `worker` are the usual ones           |
| `undercroft-installer down`           | Stop everything. The data stays                                           |
| `undercroft-installer update`         | Move to this installer's release                                          |
| `undercroft-installer uninstall`      | Remove everything, data included. `--keep-data` keeps the data and `.env` |

The services restart with Docker, so after a reboot Undercroft comes back once Docker Desktop
is open.

### Updating

Download the newer installer (run `install.sh` again, or download the new `.exe`) and run it,
then choose to start the existing install. An installer always installs its own release: the
compose file it writes and the images it pulls come from the same release. `update --tag
vX.Y.Z` pulls another release's images under this installer's compose file. It is an escape
hatch for a rollback, not the way to update.

## Back up

Two things, and neither can be recreated:

- **The `.env` file.** `UNDERCROFT_SECRET_KEY` seals every stored token, and the passwords in it
  are the ones the data volumes were created with. Lose it and the data is still on disk, but
  nothing can open it. Keep a copy somewhere safe and private.
- **The raw lake**, the `undercroft-install_minio-data` volume. It is the only durable layer.
  Everything in Postgres is rebuilt from it, and nothing rebuilds it.

Stop the stack (`undercroft-installer down`) before copying a volume, so the copy is not taken
mid-write.

## Troubleshooting

| What you see                                                                  | Why, and what to do                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "This user may not use Docker" (Linux)                                        | Your user is not in the `docker` group. Run `sudo usermod -aG docker $USER`, sign out and back in, and run the wizard again.                                                                                                                                 |
| "Docker has no Compose v2"                                                    | Install the `docker-compose-plugin` package, or update Docker Desktop. The old `docker-compose` v1 is not enough.                                                                                                                                            |
| Docker is installed but the wizard keeps waiting                              | Docker Desktop's first start unpacks its VM and can take a few minutes. On Windows it may need WSL 2 and a restart, which its installer asks for.                                                                                                            |
| "an earlier install's data ... but the .env file that holds its keys is gone" | The volumes of an earlier install are still here and their secrets are not. Put the old `.env` back into the install folder to keep that data, or run `undercroft-installer uninstall` to delete it and start clean. The wizard never guesses between these. |
| "no matching manifest for linux/arm64"                                        | The release has no image for this CPU. Use a release that publishes arm64 images, or, only to try it out, run with `DOCKER_DEFAULT_PLATFORM=linux/amd64` (slow, under emulation).                                                                            |
| "port is already allocated"                                                   | Something else uses the port. Run the wizard again, choose _Change its settings_, and pick another port.                                                                                                                                                     |
| Undercroft has not answered after 10 minutes                                  | Read `undercroft-installer logs control-plane` and `status`. A service in `restarting` names the problem in its log.                                                                                                                                         |
| The desktop page says local sign-in works only at `http://localhost:<port>`   | You opened `127.0.0.1`. Open the `localhost` address instead.                                                                                                                                                                                                |
| macOS says the installer "cannot be opened"                                   | It was downloaded in a browser, which marks it as quarantined. Use `install.sh`, or run `xattr -d com.apple.quarantine undercroft-installer-darwin-*` once.                                                                                                  |

## Changing the installer

The install logic lives in `packages/setup` and the terminal wizard in `apps/installer-cli`.
The compose file is `deploy/compose/docker-compose.install.yml`. A test pins its services and
images to `docker-compose.server.yml`, so change both together.

| Task                                  | Does                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `task ci:installer-check`             | Compiles this machine's installer and runs it with no Docker                         |
| `task build:installer-cli`            | Compiles every platform's installer and the checksums into `apps/installer-cli/dist` |
| `task cd:installer-upload TAG=vX.Y.Z` | Attaches them and `install.sh` to a release. The release workflow runs it            |
| `task ci:compose-check`               | Checks every compose file, this one included, declares memory limits                 |
