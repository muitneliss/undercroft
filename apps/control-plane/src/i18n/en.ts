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
    browseRefused: "The processing service could not fetch the list for {{source}}.",
    browseUnsupported: "{{source}} has no list to choose what it reads from.",
    scopeNotUnderstood: "The selection for {{source}} could not be read.",
    ingestNotConfigured:
      "This deployment is not set up to connect Google accounts. Tell whoever administers it.",
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
};
