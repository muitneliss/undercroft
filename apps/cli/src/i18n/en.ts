/**
 * English, the second language. Answers every key `vi.ts` declares; `index.ts` pins that.
 */

import type { TopicKey } from "../manifest.ts";

export const en = {
  cli: {
    description: "Undercroft from a terminal: everything the web UI does, through the same API.",
  },

  topics: {
    account: "Your own account.",
    accountTokens: "Personal access tokens, for an agent connecting over MCP or through the CLI.",
    accountApps: "The apps you let in by signing in and consenting, such as a Claude connector.",
    auth: "Signing in and out, and your session.",
    bi: "Reports: questions, dashboards and the schema.",
    biQuestions: "Saved questions.",
    biDashboards: "Dashboards.",
    biExports: "Every row of a question, a definition or a model, as a CSV file.",
    config: "The CLI's environment profiles, and the server's public configuration.",
    connections: "Data sources and their grants.",
    dq: "Data quality.",
    keys: "Ingest keys.",
    lake: "The raw lake.",
    models: "dbt models.",
    macros: "The customer's own dbt macros, which every model can call.",
    seeds: "The customer's small reference tables (dbt seeds), which models read with ref().",
    documentKinds: "The customer's catalogue of document kinds.",
    people: "Who has access, and invitations.",
    audit:
      "Who did what: your own actions, a customer's for its admins, everything for a superadmin.",
    runs: "Runs.",
    session: "The current session.",
    tenants: "Customers.",
  } satisfies Record<TopicKey, string>,

  command: {
    authLogin:
      "Sign in with a one-time code sent to your email, as the web UI does. An install on this machine signs you in at once, with no code. A script or an agent with nobody at its terminal signs in with a personal access token held in an environment variable: --token-env.",
    authLogout:
      "Sign out: end the session on the server, then forget it for this origin. For a token, only the variable holding it is forgotten; the token works until you revoke it.",
    authStatus: "Say which server you are signed in to, and as which address.",
    configShow:
      "Show the profile in use, its URL, whether it allows writes, and where each value came from. Never prints the session or a token.",
    configSetProfile: "Create or change a named environment profile.",
    configUse: "Choose the default profile.",
    describe:
      "List every command with its effect, or describe one command and the schema of its input.",
    biExportsDownload:
      "Save an export to a file: the link `bi exports create` answered with, fetched with your session on that same server.",
  },

  flag: {
    agent: "Agent mode: one JSON envelope on stdout, no prompts, no colour.",
    json: "Print the result as a JSON envelope (as --agent does).",
    noInput: "Never prompt; a missing argument is an immediate error.",
    noColor: "No ANSI colour.",
    quiet: "Fewer incidental notices.",
    verbose: "Write diagnostics to stderr.",
    yes: "Confirm a destructive command in advance.",
    dryRun: "Check the input locally and print the request without calling the server.",
    profile: "The environment profile to use.",
    url: "A one-off server URL; never allows writes.",
    lang: "The language of messages (vi or en).",
    input: "JSON input: `-` to read stdin, or a path to a file.",
    inputJson: "JSON input written inline.",
    email: "The email address to sign in with.",
    code: "The six-digit code from the email.",
    local:
      "Sign in on this machine, with no email and no code, when the server runs on this machine and offers it.",
    tokenEnv:
      "The NAME of the environment variable holding a personal access token (minted on the Account page), never the token itself. Only the name is kept; the token is read again at every call.",
    profileUrl: "The server's base URL for this profile.",
    allowWrites:
      "Allow write commands on this profile. Only a person at a terminal can turn it on.",
    profileName: "The profile's name.",
    commandName: "The command to describe, e.g. `runs.trigger` or `runs trigger`.",
    field: "The input's `{{name}}` field.",
    exportLink: "The link (url or path) `bi exports create` answered with.",
    out: "The file to write the CSV to.",
  },

  prompt: {
    tenant: "Choose a customer",
    tenantDeactivated: "{{label}} (deactivated)",
    value: "Enter {{name}}",
    email: "Email address",
    code: "The six-digit code from the email",
    confirmDestructive: "{{command}} deletes data and cannot be undone. Continue?",
  },

  note: {
    codeRequested:
      "If {{email}} has access, a code has been sent to it. Run again with --code to sign in.",
    signedIn: "Signed in to {{origin}} as {{email}}.",
    signedInLocally: "Signed in to {{origin}} as {{email}}, on this machine, with no code.",
    signedInWithToken:
      "Signed in to {{origin}} as {{email}}, with the token in {{variable}}. Every command reads that variable again; the token is stored nowhere.",
    signedOut: "Signed out of {{origin}}.",
    tokenForgotten:
      "Forgot the token sign-in for {{origin}}. The token in {{variable}} still works until you revoke it on the Account page.",
    noRows: "No rows.",
    downloaded: "Saved {{bytes}} bytes to {{path}}.",
  },

  page: {
    name: "Undercroft",
    tagline: "Everything the web UI does, through the same API.",
    edition: "Edition {{version}}",
    profile: "profile {{profile}}",
    signedOut: "Not signed in",
    noServer: "No server chosen",
    chooseServer: "Choose a server",
    setProfileCommand: "undercroft config set-profile <name> --url <url>",
    signIn: "Sign in",
    forAgents: "For agents",
    everyCommand: "Every command",
    otherLanguage: "Tiếng Việt",
    contents: "CONTENTS",
    appendix: "APPENDIX",
    commands: "commands",
    readOnly: "read-only",
    writesOn: "WRITES ON",
    topicHelp: "undercroft <topic> --help",
    commandHelp: "undercroft describe <command>",
    erratum: "ERRATUM",
  },

  login: {
    intro: "Sign in to {{origin}}",
    codeSent: "If {{email}} has access, a code has been sent to it.",
    pasteHint: "Pasting all six digits works too.",
    codeShape: "The code is exactly six digits.",
    checking: "Checking the code",
    next: "What next?",
    resend: "Send a new code to {{email}}",
    otherEmail: "Use a different email",
    quit: "Quit",
  },

  error: {
    INVALID_ARGUMENT: "Invalid arguments for {{command}}.",
    inputUnreadable: "Could not read JSON input from {{source}}.",
    inputNotObject: "JSON input must be an object.",
    unknownProfile: "No profile named “{{profile}}” is configured.",
    MISSING_REQUIRED_ARGUMENT: "Missing required arguments: {{names}}.",
    UNKNOWN_COMMAND: "There is no command “{{command}}”. Run `undercroft describe` for the list.",
    CONFIG_REQUIRED:
      "No server chosen. Use --profile, --url, or create a profile with `undercroft config set-profile`.",
    configUnreadable: "Could not read {{path}}; repair or remove it.",
    CONFIRMATION_REQUIRED: "{{command}} deletes data; in agent mode it needs --yes.",
    NOT_FOUND: "Not found.",
    CONFLICT: "The server refused because of its current state.",
    AUTHENTICATION_REQUIRED: "Not signed in to {{origin}}. Run `undercroft auth login`.",
    codeRejected: "The code was not accepted. Request a new one.",
    tokenUnset:
      "Signed in to {{origin}} with the token in {{variable}}, but that variable is unset or empty. Set it for this process.",
    tokenRefused:
      "{{origin}} refused the token in {{variable}}: it was revoked, it expired, or it is not one of this server's. Mint a new one on the Account page and put it in {{variable}}.",
    tokenEnvName:
      "--token-env takes the NAME of an environment variable (letters, digits and underscores), never the token itself.",
    localNotLoopback:
      "Signing in on this machine works only with a server on this machine (localhost), and {{origin}} is not one. Sign in with your email.",
    noLocalMethod:
      "{{origin}} does not offer signing in on this machine. Sign in with your email: `undercroft auth login --email <address>`.",
    PERMISSION_DENIED: "You do not have permission to do this.",
    tokenReadOnly:
      "The token in {{variable}} may only read, and this command needs the write grant. Mint a token that may write on the Account page if you mean to allow it.",
    WRITES_DISABLED:
      "Profile “{{profile}}” does not allow writes. A person has to turn it on at a terminal: `undercroft config set-profile {{profile}} --allow-writes`.",
    writesNeedProfile: "A one-off URL never allows writes; use a named profile.",
    HUMAN_REQUIRED: "Only a person at a terminal can allow writes on a profile.",
    NETWORK_ERROR: "Could not reach {{origin}}.",
    TIMEOUT: "{{origin}} did not answer within {{seconds}} seconds.",
    VALIDATION_FAILED: "The server refused the input.",
    localValidation: "The input does not match the command's schema.",
    CANCELLED: "Cancelled; nothing changed.",
    INTERNAL_ERROR: "The server had an internal error.",
    traceId: "Trace ID: {{traceId}} -- quote it when you report this.",
    downloadElsewhere:
      "The link points to {{link}}, not {{origin}}, which this command is using. Your session is only ever sent to the server that issued it; choose the right profile or --url.",
    downloadCut:
      "The download was cut off, so no file was written: a file missing rows looks like a whole one. Ask for the export again.",
    outUnwritable: "Could not write to {{path}}.",
  },
};
