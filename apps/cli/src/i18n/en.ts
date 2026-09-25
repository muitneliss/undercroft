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
    accountTokens: "Personal access tokens, for an agent connecting over MCP.",
    accountApps: "The apps you let in by signing in and consenting, such as a Claude connector.",
    auth: "Signing in and out, and your session.",
    bi: "Reports: questions, dashboards and the schema.",
    biQuestions: "Saved questions.",
    biDashboards: "Dashboards.",
    config: "The CLI's environment profiles, and the server's public configuration.",
    connections: "Data sources and their grants.",
    dq: "Data quality.",
    keys: "Ingest keys.",
    lake: "The raw lake.",
    models: "dbt models.",
    people: "Who has access, and invitations.",
    runs: "Runs.",
    session: "The current session.",
    tenants: "Customers.",
  } satisfies Record<TopicKey, string>,

  command: {
    authLogin: "Sign in with a one-time code sent to your email, as the web UI does.",
    authLogout: "Sign out: end the session on the server, then forget it for this origin.",
    authStatus: "Say which server you are signed in to, and as which address.",
    configShow:
      "Show the profile in use, its URL, whether it allows writes, and where each value came from. Never prints the session.",
    configSetProfile: "Create or change a named environment profile.",
    configUse: "Choose the default profile.",
    describe:
      "List every command with its effect, or describe one command and the schema of its input.",
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
    profileUrl: "The server's base URL for this profile.",
    allowWrites:
      "Allow write commands on this profile. Only a person at a terminal can turn it on.",
    profileName: "The profile's name.",
    commandName: "The command to describe, e.g. `runs.trigger` or `runs trigger`.",
    field: "The input's `{{name}}` field.",
  },

  prompt: {
    tenant: "Choose a customer",
    value: "Enter {{name}}",
    email: "Email address",
    code: "The six-digit code from the email",
    confirmDestructive: "{{command}} deletes data and cannot be undone. Continue?",
  },

  note: {
    codeRequested:
      "If {{email}} has access, a code has been sent to it. Run again with --code to sign in.",
    signedIn: "Signed in to {{origin}} as {{email}}.",
    signedOut: "Signed out of {{origin}}.",
    noRows: "No rows.",
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
    PERMISSION_DENIED: "You do not have permission to do this.",
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
  },
};
