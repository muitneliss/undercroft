/**
 * English, the second language. Answers every key `vi.ts` declares; `index.ts` pins that.
 */

import type { CliProblemCode } from "../services/options.ts";

export const en = {
  help: [
    "Install and run Undercroft on this machine with Docker.",
    "",
    "Usage: undercroft-installer [command] [options]",
    "",
    "Commands:",
    "  up         Install, or start the existing install (the default)",
    "  down       Stop Undercroft; the data is kept",
    "  status     Each service's state",
    "  logs       Follow the log (logs [service])",
    "  update     Move to this installer's release, or to --tag vX.Y.Z",
    "  uninstall  Remove the install; add --keep-data to keep the data",
    "",
    "Common options: --lang vi|en, --dir <folder>, --yes (ask nothing), --help, --version",
    "Unattended install: --mode desktop|server, --port, --bind, --public-url, --admin,",
    "  --email-api-key, --email-from, --google-client-id, --google-client-secret,",
    "  --google-ingest-client-id, --google-ingest-client-secret, --xero-client-id,",
    "  --xero-client-secret, --tag, --dry-run, --no-open",
    "",
    "Full guide: docs/runbook/install.md",
  ].join("\n"),

  intro: "Installing Undercroft {{version}}",
  outro: "Done.",
  pressEnter: "Press Enter to close this window.",
  cancelled: "Cancelled. Nothing changed after the last step that finished.",
  badInvocation: "Could not read this command: {{detail}}. See --help.",
  noInstall: "There is no install in {{dir}}. Run undercroft-installer to install.",
  stepFailed: "This step did not succeed. The last lines Docker printed:",

  language: {
    question: "Ngôn ngữ / Language",
  },

  mode: {
    question: "Who is this install for?",
    desktop: "Just me, on this machine",
    desktopHint: "opens on localhost, signs you in, no email needed",
    server: "A team, on a server",
    serverHint: "needs an https address, a reverse proxy and a sign-in method",
    name: {
      desktop: "desktop",
      server: "server",
    },
  },

  existing: {
    found: "There is an install in {{dir}}: {{url}}",
    question: "What would you like to do?",
    start: "Start it",
    reconfigure: "Change its settings (passwords and secret keys are kept)",
  },

  docker: {
    checking: "Checking Docker…",
    ready: "Docker is ready (Compose {{version}}).",
    missing: "Docker is not on this machine. Undercroft runs in Docker.",
    licence:
      "Docker Desktop is free for individuals and small businesses; a company with more than 250 employees or more than USD 10 million in revenue needs a paid licence.",
    offerInstall: "Install Docker now with: {{command}}?",
    installManual:
      "Download and install Docker from {{url}}, open it, then run the installer again.",
    stopped: "Docker is installed but not running.",
    offerStart: "Open Docker now?",
    startManual: "Open Docker, wait until it says it is running, then run the installer again.",
    waiting: "Waiting for Docker to start…",
    noPermission:
      "This user may not use Docker. Run: sudo usermod -aG docker $USER, sign out and back in, then run the installer again.",
    noCompose:
      "Docker has no Compose v2. Install the docker-compose-plugin package (or update Docker Desktop), then run the installer again.",
    notReady: "Docker is not ready, and --yes does not install it. Install and open Docker first.",
  },

  settings: {
    port: "Port on this machine",
    bind: "Address to publish the port on (127.0.0.1 when the reverse proxy runs on this server)",
    publicUrl: "The https address everyone opens Undercroft at",
    adminEmail: "The first administrator's email",
    signIn: "How do people sign in?",
    signInEmail: "A one-time code by email (Resend)",
    signInGoogle: "Their Google account",
    emailApiKey: "Resend API key",
    emailFrom: "Sender, for example: Undercroft <no-reply@your-domain>",
    googleClientId: "Client ID of the Google sign-in app",
    googleClientSecret: "Client secret of the Google sign-in app",
    keep: "(leave empty to keep the current one)",
    required: "This is required.",
  },

  connectors: {
    question: "Turn on more data sources? (HubSpot is always there and needs no setup)",
    hint: "space to choose, Enter to continue",
    googleIngest: "Gmail and Google Drive",
    xero: "Xero",
    clientId: "{{name}} client ID",
    clientSecret: "{{name}} client secret",
  },

  install: {
    summary: "Installing in {{mode}} mode into {{dir}}, opening at {{url}}, release {{tag}}.",
    confirm: "Start the install?",
    dryRun: "Dry run: no file is written and Docker is not called.",
    written: "Wrote the settings into {{dir}}.",
    orphaned:
      "This machine still holds an earlier install's data ({{volume}}), but the .env file that holds its keys is gone. Restore that .env into {{dir}}, or run undercroft-installer uninstall to delete the old data.",
    pulling: "Downloading the images (a few minutes the first time)…",
    pulled: "The images are downloaded.",
    starting: "Starting the services (Kestra takes about a minute the first time)…",
    started: "The services are running.",
    waiting: "Waiting for Undercroft to answer…",
    unhealthy:
      "Undercroft has not answered after {{minutes}} minutes ({{error}}). Read its log with undercroft-installer logs control-plane.",
  },

  done: {
    desktop: "Undercroft is running at {{url}} — you are signed in as its owner.",
    cli: "From the undercroft CLI: undercroft config set-profile local --url {{url}}, then undercroft auth login — no code needed.",
    server: "Undercroft is running on {{bind}}:{{port}}.",
    proxy: "Point your https reverse proxy at http://{{bind}}:{{port}}; everyone opens {{url}}.",
    admin: "The administrator {{email}} signs in at {{url}} and invites everyone else.",
    redirects: "Register these redirect URIs with each provider:",
    backup:
      "Back up {{env}}: it holds UNDERCROFT_SECRET_KEY and the data volumes' passwords, and losing it loses access to the data. The raw lake (the minio-data volume) is the one layer that cannot be rebuilt.",
  },

  redirect: {
    googleSignIn: "Google (sign-in): {{uri}}",
    googleIngest: "Google (Gmail, Drive): {{uri}}",
    xero: "Xero: {{uri}}",
  },

  problem: {
    "port-invalid": "The port must be a whole number from 1 to 65535.",
    "image-tag-invalid": "The release must look like vX.Y.Z.",
    "bind-invalid":
      "The address to publish on must be an IPv4 address, such as 127.0.0.1 or 0.0.0.0.",
    "public-url-invalid":
      "The address must be an origin, such as https://data.example.test, with no path.",
    "public-url-not-https":
      "A server's address must be https: a signed-in session must not cross the network in clear text.",
    "admin-email-invalid": "The administrator's email is not valid.",
    incomplete: "A part of {{field}} is empty.",
    unwritable: "{{field}} holds a single quote or a line break, which the .env file cannot carry.",
    "desktop-bind":
      "A desktop install is published on 127.0.0.1 only; --bind goes with --mode server.",
  } satisfies Record<CliProblemCode, string>,

  field: {
    port: "the port",
    imageTag: "the release",
    bind: "the address to publish on",
    publicUrl: "the https address",
    adminEmail: "the administrator's email",
    signIn: "the sign-in method",
    googleIngest: "Gmail and Google Drive",
    xero: "Xero",
  },

  status: {
    none: "No service is running.",
    unknown: "Docker could not say what state the services are in.",
    row: "{{service}}: {{state}}",
  },

  down: {
    done: "Undercroft is stopped. The data is kept; run undercroft-installer up to start it again.",
  },

  update: {
    summary: "Moving the install in {{dir}} from {{from}} to {{to}}.",
  },

  uninstall: {
    needsYes: "No terminal to confirm at: add --yes to confirm the uninstall.",
    confirmKeep: "Remove Undercroft's containers, keeping the data and the .env file?",
    confirmAll:
      "Delete Undercroft for good, with ALL its data: the raw lake, the database and the .env file. This cannot be undone. Continue?",
    doneKeep: "Removed the containers. The data and {{dir}} are kept.",
    doneAll: "Deleted Undercroft and all its data.",
  },
};
