/**
 * English, for the colleagues and auditors who do not read Vietnamese.
 *
 * `vi.ts` decides which keys exist; this file answers them, and `index.ts` makes that a
 * typecheck rather than a hope. Most of this is the wording the control plane shipped with.
 */

export const en = {
  email: {
    colophon: "Undercroft sent this automatically. No reply is needed.",
    customer: "Customer",
    source: "Source",
    account: "Account",
    address: "Address",
    when: "When",
    expires: "Expires",
    key: "Key",
    errata: "Erratum",
  },

  invitation: {
    subject: "You have access to Undercroft",
    heading: "An invitation to Undercroft",
    lead: "You have been given access to {{tenantId}}.",
    howToSignIn:
      "Sign in with this address exactly, either with Google or by asking for a one-time code.",
    action: "Sign in",
    ignore: "If you were not expecting this, you can ignore it; nothing happens until you sign in.",
  },

  signInCode: {
    subject: "Your Undercroft sign-in code",
    heading: "Your sign-in code",
    lead: "Use this code to sign in to Undercroft.",
    expiry: "It expires in {{minutes}} minutes.",
    ignore: "If you did not ask to sign in, you can ignore this email.",
  },

  runFailed: {
    subject: "The {{source}} sync for {{tenantId}} failed",
    modelsSubject: "The model build for {{tenantId}} failed",
    models: "Model build",
    noReason: "no reason recorded",
    heading: "A run failed",
    lead: "What this run would have updated is unchanged until a later one succeeds.",
    action: "See the journal",
    repeats:
      "If it keeps failing you will not receive another email about this source for 24 hours; a successful run resets that window.",
  },

  syncCard: {
    reason: "Reason",
    failingSince: "Failing since",
    recovered: "The {{source}} sync for {{tenantId}} is working again",
    modelsRecovered: "The model build for {{tenantId}} is working again",
  },

  grantExpiring: {
    subject: "{{tenantId}}'s {{source}} access is about to expire",
    heading: "Access is about to expire",
    lead: "Reconnect the source before then so syncing is not interrupted.",
    action: "Reconnect",
  },

  keyExpiring: {
    subject: "{{tenantId}}'s ingest key “{{label}}” is about to expire",
    heading: "An ingest key is about to expire",
    lead: "Mint a new key under Sources and pass it to whoever uses this one.",
    action: "Open Sources",
  },

  error: {
    notInvited:
      "That address has not been invited. Ask an administrator for an invitation, and sign in with the exact address it was sent to.",
    alreadyMember: "{{email}} already has access as {{role}}.",
    noOpenInvitation: "No open invitation with that id.",
    notMember: "{{email}} does not have access to this customer.",
    lastAdmin:
      "{{email}} is this customer's only admin. Make someone else an admin first, so the customer is not left with nobody who can manage access.",
    requiresRole: "This action requires the {{role}} role.",
    requiresSuperadmin: "This action requires platform administrator access.",
    writesDisabled:
      "This token may only read, so it cannot do this. Mint a token that may write on the Account page if you mean to allow it.",
    requiresSession:
      "This can only be done from a signed-in browser (or the CLI), never with a token.",
    tenantExists: "The tenant ID {{tenantId}} is already in use by another customer.",
    tenantRoleCollision:
      "The tenant ID {{tenantId}} is too close to another customer's (it differs only in case or punctuation). Choose one that differs in more than that.",
    modelNameTaken:
      "A model named {{name}} already exists. Open it to edit, or choose another name.",
    buildInProgress:
      "A build is already running for this customer. Wait for it to finish, then try again.",
    buildNotStarted:
      "The model could not be built. The processing service did not answer; try again in a few minutes.",
    dqNotRead: "The failing rows for this step could not be read.",
    queryFailed: "The query did not run: {{message}}",
    queryNotRun:
      "The query could not be run. The processing service did not answer; try again in a few minutes.",
    searchNotRun:
      "The search could not be run. The processing service did not answer; try again in a few minutes.",
    paramMissing: "The question needs a value for {{name}}. Set that filter and run again.",
    workerUnavailable:
      "The list could not be fetched from Google just now. The processing service did not answer; try again in a few minutes.",
    scopeInsufficient:
      "The {{source}} connection does not currently carry enough permission to read this list. Connect the source again, leaving every permission it asks for ticked on the consent screen.",
    credentialExpired:
      "The access granted to the {{source}} connection has expired or been revoked, so the list could not be fetched. Connect the source again, then come back to this screen.",
    browseRefused: "The processing service could not fetch the list for {{source}}.",
    browseUnsupported: "{{source}} has no list to choose what it reads from.",
    scopeNotUnderstood: "The selection for {{source}} could not be read.",
    cronFields:
      "A cron expression has exactly five fields: minute, hour, day of month, month, day of week.",
    cronInvalid: "The cron expression “{{cron}}” could not be read.",
    cronNever: "The cron expression “{{cron}}” never comes round.",
    cronTooFrequent:
      "The cron expression “{{cron}}” runs more often than every {{minutes}} minutes, faster than the scheduler ticks.",
    cronWithoutCustom:
      "Only a custom schedule takes a cron expression; choose “custom”, or leave the cron out.",
    propertiesInsufficient:
      "The HubSpot access token does not currently carry enough permission to read the list of properties. In HubSpot, give the private app read access to companies, contacts and deals (crm.objects.companies.read, crm.objects.contacts.read, crm.objects.deals.read), then paste the token again if HubSpot issued a new one.",
    ingestNotConfigured:
      "This deployment is not set up to connect {{provider}} accounts. Tell whoever administers it.",
    sourceNotConnectable: "{{source}} cannot be connected automatically yet.",
    runInProgress: "{{source}} is being synced right now. Wait for that run to finish.",
    runNotStarted:
      "The sync could not be started. The processing service did not answer; try again in a few minutes.",
    runRefused: "The processing service refused to sync {{source}}.",
    tokenRejected:
      "{{source}} did not accept this token. Check the pasted token and the private app's scopes, then try again.",
    tokenNotStored:
      "The token for {{source}} could not be stored. The processing service refused it.",
    assistantUnconfigured:
      "The assistant is not set up for this deployment. Tell whoever administers it.",
    assistantBadRequest: "The question could not be sent. Reload the page and try again.",
    assistantThreadFull: "This conversation has grown too long. Clear it to start a new one.",
  },

  modelCheck: {
    finding: {
      empty: "The model has no SQL yet.",
      semicolon:
        "Remove the semicolon. dbt wraps a model in CREATE TABLE ... AS, so a semicolon ends that statement early and the build fails.",
      "not-select":
        "A model is one query starting with select, with or values. dbt makes the table from its result.",
      "write-statement":
        "A model must not write: remove {{subject}}. It only reads; dbt creates the table from the select.",
      "select-into":
        "Remove select ... into. dbt creates the model's table itself; into would create a second one outside dbt.",
      "raw-direct":
        "Read raw.{{subject}} through dbt's source() function, naming the undercroft source, rather than directly -- so dbt knows what the model depends on.",
      "analytics-direct":
        "Read {{subject}} through dbt's ref() rather than by its schema, so dbt builds that model before this one.",
      "unknown-source": "There is no source {{subject}}. models.reference lists the sources.",
      "unknown-ref": "This customer has no model named {{subject}}.",
      "self-ref": "A model cannot read itself.",
      "no-tombstone-filter":
        "The model reads records but never mentions deleted_at. Without deleted_at is null, a record deleted at its source shows as live.",
      "zero-default":
        "coalesce(…, 0) turns a missing value into a real-looking zero. Leave it NULL unless 0 is truly what it means.",
      "top-level-limit":
        "A limit on the whole query saves only part of the data as the model. Keep it only if that is intended.",
      "unknown-macro":
        "{{subject}} is neither a macro this project ships nor a dbt function. models.reference lists the macros.",
      "dynamic-reference":
        "The name passed to {{subject}} is not written out as plain text, so whether it exists cannot be checked.",
      "test-column-unmentioned":
        "There is a test for column {{subject}}, but the SQL never mentions that column.",
    },
    unverified: {
      compiles: "Whether the SQL compiles and runs: only a build knows.",
      "payload-keys": "Whether the keys read from the payload exist in the data.",
      "column-types":
        "What type each column comes out as, and whether each cast holds for every row.",
      "tests-pass": "Whether the tests pass: only a build runs them.",
      "function-effects":
        "What the called functions do: the grants on the customer's dbt login decide that.",
    },
  },

  mcp: {
    refused: {
      AUTHENTICATION_REQUIRED: "Sign-in required. The token is no longer valid.",
      PERMISSION_DENIED: "You do not have permission to do this.",
      NOT_FOUND: "Not found.",
      CONFLICT: "The platform's current state does not allow this.",
      VALIDATION_FAILED: "The input is not valid. The details are in details.issues.",
      TIMEOUT: "The server did not answer in time.",
      NETWORK_ERROR: "Too many requests. Try again in a few minutes.",
      INTERNAL_ERROR:
        "The server failed. Report it with the trace id (traceId) so an operator can find it.",
    },
    unknownTool: "There is no tool named {{tool}} for this token.",
    unknownResource: "There is no resource called {{uri}}.",
    rowsClipped:
      "This text shows {{shown}} of the {{total}} items in {{field}}. The complete result is in structuredContent.",
    textClipped:
      "This text was cut at {{kilobytes}} KB. The complete result is in structuredContent.",
  },
};
