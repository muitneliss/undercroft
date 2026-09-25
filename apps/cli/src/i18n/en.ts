/**
 * English, the second language. Answers every key `vi.ts` declares; `index.ts` pins that.
 */

export const en = {
  cli: {
    description: "Undercroft from a terminal: everything the web UI does, through the same API.",
  },

  topics: {
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
  },

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

  procedures: {
    session: {
      me: "Who you are on this server.",
      signOut: "End the current session on the server.",
      setLocale: "Remember the language you read, for emails sent while no page is open.",
    },
    tenants: {
      list: "The customers you have access to.",
      get: "One customer, and your role in it.",
      create: "Create a customer. Platform superadmins only.",
      rename: "Correct a customer's display name. Tenant admins.",
    },
    connections: {
      list: "A customer's sources and how each is connected.",
      get: "One source and how it is connected.",
      startOAuth: "Begin an OAuth grant; returns the URL to open in a browser. Admins.",
      browseScope:
        "What may be chosen for a source's scope: Gmail labels, Xero organisations, Google Drive folders with their paths and the file types present, or each HubSpot object's properties, the portal's own included. Admins.",
      setScope:
        "Set what a source reads. For HubSpot, the properties chosen for each object are read as well as the standard ones, never instead of them. Admins.",
      setToken: "Connect a source with a pasted token. Admins.",
      setCadence:
        "Set how often a source is read: hourly, every_6h, daily, paused, or custom with --cron, a five-field cron expression in Singapore time that fires at most every five minutes. Admins.",
      disconnect: "End a source's grant. Admins.",
    },
    keys: {
      list: "The customer's ingest keys. Admins.",
      mint: "Mint an ingest key; its token is returned this once. Admins.",
      revoke: "Revoke an ingest key. Admins.",
    },
    people: {
      members: "Who has access to the customer.",
      invitations: "The open invitations.",
      invite: "Invite an address with a role. Admins.",
      revokeInvitation: "Withdraw an open invitation. Admins.",
      setRole: "Change the role a member holds; never the last admin's. Admins.",
      removeMember: "End a member's access; never the last admin's. Admins.",
    },
    lake: {
      summary: "What has landed, per stream: counts and freshness.",
      records: "An entity's raw records. Admins.",
      documents: "A source's raw documents. Admins.",
      query: "Run one SELECT over the raw lake. Admins.",
      search: "Full-text search over the raw lake. Admins.",
      querySchema: "The tables and columns lake query can read. Admins.",
    },
    models: {
      list: "The customer's dbt models.",
      get: "One dbt model and its SQL.",
      save: "Store a dbt model; runs nothing. Admins.",
      delete: "Delete a dbt model. Admins.",
      build: "Build one model with dbt and wait for the answer. Admins.",
      reference: "Reference material for a model's author.",
    },
    bi: {
      answer: "Answer a question definition. Members and above.",
      runQuestion: "Run a saved question with parameters.",
      compile: "Compile a question definition to SQL. Members and above.",
      schema: "The tables and columns reports can read.",
      questions: {
        list: "The saved questions.",
        get: "One saved question.",
        answer: "A saved question's answer under parameters.",
        save: "Save a question. Members and above.",
        delete: "Delete a question. Members and above.",
      },
      dashboards: {
        list: "The dashboards.",
        get: "One dashboard.",
        save: "Save a dashboard. Members and above.",
        delete: "Delete a dashboard. Members and above.",
      },
    },
    dq: {
      failures: "The rows a failed data-quality test stored. Admins.",
    },
    runs: {
      list: "The ledger of runs, newest first.",
      get: "One run, with its refusals and dbt steps.",
      events: "What the worker is saying about a run.",
      trigger: "Read a source now. Admins.",
    },
    config: {
      google: "The public half of the Google client, for the Drive picker.",
    },
    health: "Whether the server is answering.",
  },
};
