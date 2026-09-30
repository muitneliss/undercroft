/**
 * English, the second language. Every key `vi.ts` declares is answered here; `index.ts` pins
 * that with `typeof vi`, and `i18n.test.ts` checks no key is left as its own name.
 */

export const en = {
  app: {
    name: "Undercroft",
    windowTitle: "Set up Undercroft",
  },

  steps: {
    language: "Language",
    mode: "Mode",
    docker: "Docker",
    settings: "Settings",
    connectors: "Data sources",
    install: "Install",
    done: "Done",
  },

  nav: {
    next: "Continue",
    back: "Back",
    required: "This is required.",
  },

  language: {
    title: "Ngôn ngữ / Language",
    lead: "Choose the language for the installer and for Undercroft.",
  },

  mode: {
    title: "Who are you installing Undercroft for?",
    desktop: "Just me, on this machine",
    desktopHint:
      "Opens at localhost and signs you in, no email needed. The data stays on this machine.",
    server: "My team, on a server",
    serverHint: "Needs an https address, your own reverse proxy and a way for people to sign in.",
  },

  docker: {
    title: "Docker",
    lead: "Undercroft runs in Docker. The installer checks Docker before it does anything else.",
    checking: "Checking Docker…",
    ready: "Docker is ready (Compose {{version}}).",
    missing: "Docker is not installed on this machine.",
    stopped: "Docker is installed but not running.",
    noPermission:
      "This user may not use Docker. Run sudo usermod -aG docker $USER, sign out and back in, then press Check again.",
    noCompose:
      "Docker has no Compose v2. Update Docker Desktop, or install the docker-compose-plugin package, then press Check again.",
    licence:
      "Docker Desktop is free for individuals and small businesses; a company with more than 250 employees or more than USD 10 million in revenue needs a paid subscription.",
    licenceLink: "Docker's terms",
    install: "Install Docker for me",
    installing: "Installing Docker… Windows may ask for an administrator's permission.",
    command: "It will run: {{command}}",
    runYourself: "Run this in a terminal, then come back here: {{command}}",
    download: "Download Docker",
    start: "Open Docker",
    starting: "Waiting for Docker to start… the first start can take a few minutes.",
    recheck: "Check again",
    restartNeeded:
      "Docker is installed, but Windows needs to restart to turn on WSL 2. After the restart the installer opens again at this step.",
    restart: "Restart Windows",
    restartFailed: "Could not restart. Restart the computer yourself, then open Undercroft.",
    installFailed:
      "Docker was not installed. Download and install it yourself, then press Check again.",
  },

  settings: {
    title: "Settings",
    dir: "Install folder",
    dirHint:
      "Holds the install's .env with its passwords and secret keys. The data itself lives in Docker volumes.",
    dirLocked: "The install is already in this folder; to move it, uninstall and install again.",
    choose: "Choose…",
    port: "Port on this machine",
    portHint: "Undercroft will open at {{url}}.",
    publicUrl: "The https address people open Undercroft at",
    adminEmail: "The first administrator's email",
    bind: "Address the port binds to",
    bindHint: "127.0.0.1 when the reverse proxy runs on the same server.",
    signIn: "How do people sign in?",
    signInEmail: "A one-time code by email (Resend)",
    signInGoogle: "A Google account",
    emailApiKey: "Resend API key",
    emailFrom: "Sender, for example: Undercroft <no-reply@your-domain>",
    googleClientId: "Client ID of the Google sign-in app",
    googleClientSecret: "Client secret of the Google sign-in app",
    googleRedirect: "Register this redirect URI in the Google app: {{uri}}",
    reconfigure:
      "Changing the settings of the existing install. Its passwords and secret keys are kept.",
  },

  connectors: {
    title: "Data sources",
    lead: "Optional. HubSpot is always available and needs nothing here. Gmail, Google Drive and Xero each need an OAuth app you register yourself; you can add them later from Settings in the tray.",
    googleIngest: "Gmail and Google Drive",
    xero: "Xero",
    enable: "Turn on {{name}}",
    clientId: "Client ID",
    clientSecret: "Client secret",
    redirect: "Redirect URI to register:",
    guide: "How to register the app",
    skip: "Skip for now",
  },

  install: {
    title: "Install",
    lead: "The installer will use:",
    mode: "Mode: {{mode}}",
    modeDesktop: "just me, on this machine",
    modeServer: "my team, on a server",
    dir: "Folder: {{dir}}",
    url: "Address: {{url}}",
    tag: "Release: {{tag}}",
    secretsNew: "Passwords and secret keys are generated fresh, on this machine.",
    secretsKept: "The existing passwords and secret keys are kept.",
    start: "Install",
    retry: "Try again",
    phase: {
      writing: "Writing the settings…",
      pulling: "Downloading the images (a few minutes the first time)…",
      starting: "Starting the services (Kestra takes about a minute the first time)…",
      waiting: "Waiting for Undercroft to answer…",
    },
    image: {
      pulling: "downloading",
      pulled: "done",
      failed: "failed",
    },
    failed: {
      docker: "Docker stopped answering. Go back to the Docker step.",
      invalid: "The settings are not valid yet. Go back to Settings.",
      orphaned:
        "This machine still holds an earlier install's data ({{volume}}), but the .env that held its keys is gone. Restore the .env into the install folder, or run undercroft-installer uninstall to delete the old data.",
      step: "This step failed. The last lines Docker printed:",
      unhealthy:
        "Undercroft did not answer ({{error}}). See the log in Docker Desktop, or run undercroft-installer logs control-plane.",
      noInstall: "There is no install in this folder.",
    },
  },

  done: {
    title: "Done",
    desktop: "Undercroft is running at {{url}}. You are signed in as its owner straight away.",
    cli: "From the undercroft CLI: undercroft config set-profile local --url {{url}}, then undercroft auth login — no code needed.",
    server:
      "Undercroft is running. Point your https reverse proxy at port {{port}}; the administrator {{email}} signs in at {{url}} and invites everyone else.",
    open: "Open Undercroft",
    close: "Close this window",
    tray: "Undercroft keeps running when the window is closed; its icon is in the system tray.",
    backup:
      "Back up {{env}}: it holds UNDERCROFT_SECRET_KEY and the data volumes' passwords. Lose it and the data cannot be opened.",
  },

  problem: {
    "port-invalid": "The port must be a whole number from 1 to 65535.",
    "image-tag-invalid": "The release must look like vX.Y.Z.",
    "bind-invalid": "The bind address must be an IPv4 address, such as 127.0.0.1 or 0.0.0.0.",
    "public-url-invalid":
      "The address must be an origin, such as https://data.example.com, with no path.",
    "public-url-not-https":
      "A server's address must be https: a sign-in session must not cross the network in clear text.",
    "admin-email-invalid": "The administrator's email is not valid.",
    incomplete: "Part of {{field}} is empty.",
    unwritable: "{{field}} holds a single quote or a line break, which the .env cannot carry.",
    "dir-required": "Choose an install folder.",
  },

  field: {
    dir: "the install folder",
    port: "the port",
    imageTag: "the release",
    bind: "the bind address",
    publicUrl: "the https address",
    adminEmail: "the administrator's email",
    signIn: "the sign-in method",
    googleIngest: "Gmail and Google Drive",
    xero: "Xero",
  },

  tray: {
    open: "Open Undercroft",
    start: "Start",
    stop: "Stop",
    status: "Status",
    settings: "Settings…",
    logs: "Logs folder",
    updates: "Check for updates",
    uninstall: "Uninstall…",
    quit: "Quit",
  },

  dialog: {
    ok: "OK",
    cancel: "Cancel",
    starting: "Starting Undercroft…",
    started: "Undercroft is running at {{url}}.",
    startFailed: "Undercroft could not be started.",
    stopped: "Undercroft is stopped. Its data is kept.",
    stopFailed: "Undercroft could not be stopped.",
    statusTitle: "The services",
    statusNone: "No service is running.",
    statusUnknown: "Docker could not say.",
    statusRow: "{{service}}: {{state}}",
    uninstallTitle: "Uninstall Undercroft",
    uninstallQuestion: "Remove Undercroft's containers from this machine?",
    uninstallDetail:
      "Keep data: you can install again later with the same data. Delete everything: removes the raw lake, the database and the .env; this cannot be undone.",
    uninstallKeep: "Remove, keep data",
    uninstallAll: "Delete everything",
    uninstallConfirm: "Delete ALL of Undercroft's data on this machine? This cannot be undone.",
    uninstallDoneKeep: "The containers are removed. The data and {{dir}} are kept.",
    uninstallDoneAll:
      "Undercroft and all its data are removed. To remove this app too, delete it as you would any other.",
    uninstallFailed: "Undercroft was not uninstalled.",
    noInstall: "Nothing is installed yet. Open Settings… to install.",
    updatesNone: "You have the latest release.",
    updatesAvailable: "Release {{version}} is available. Download it and restart the app?",
    updatesInstall: "Update",
    updatesLater: "Later",
    updatesFailed: "Could not check for updates: {{error}}",
    updatesDev: "A development build does not update itself.",
    updatesStack:
      "The app is updated. Choose Start in the tray to move Undercroft to the new release.",
  },
};
