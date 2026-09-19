/**
 * English, for the colleagues and auditors who do not read Vietnamese.
 *
 * `vi.ts` decides which keys exist; this file answers them, and `index.ts` makes that a
 * typecheck rather than a hope. Most of this is the wording the control plane shipped with.
 */

export const en = {
  invitation: {
    subject: "You have access to Undercroft",
    body: [
      "You have been given access to {{tenantId}} in Undercroft.",
      "",
      "Sign in at {{publicUrl}} — use this address ({{email}}) exactly, either with Google or by asking for a one-time code.",
      "",
      "If you were not expecting this, you can ignore it; nothing happens until you sign in.",
    ].join("\n"),
  },

  signInCode: {
    subject: "Your Undercroft sign-in code",
    body: [
      "Your sign-in code is {{otp}}",
      "",
      "It expires in {{minutes}} minutes. If you did not ask to sign in, you can ignore this email.",
    ].join("\n"),
  },

  runFailed: {
    subject: "The {{source}} sync for {{tenantId}} failed",
    models: "the model build",
    noReason: "no reason recorded",
    body: [
      "The {{source}} run for {{tenantId}} at {{when}} failed.",
      "",
      "Reason: {{error}}",
      "",
      "See the detail in the journal: {{link}}",
      "",
      "If it keeps failing you will not receive another email about this source for 24 hours; a successful run resets that window.",
    ].join("\n"),
  },

  grantExpiring: {
    subject: "{{tenantId}}'s {{source}} access is about to expire",
    body: [
      "The {{source}} access that {{tenantId}} granted expires on {{when}}.",
      "",
      "Reconnect the source under Sources before then so syncing is not interrupted: {{link}}",
    ].join("\n"),
  },

  keyExpiring: {
    subject: "{{tenantId}}'s ingest key “{{label}}” is about to expire",
    body: [
      "The ingest key “{{label}}” for {{tenantId}} expires on {{when}}.",
      "",
      "Mint a new key under Sources and pass it to whoever uses this one: {{link}}",
    ].join("\n"),
  },

  error: {
    notInvited:
      "That address has not been invited. Ask an administrator for an invitation, and sign in with the exact address it was sent to.",
    alreadyMember: "{{email}} already has access as {{role}}.",
    noOpenInvitation: "No open invitation with that id.",
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
    paramMissing: "The question needs a value for {{name}}. Set that filter and run again.",
    workerUnavailable:
      "The list could not be fetched from Google just now. The processing service did not answer; try again in a few minutes.",
    scopeInsufficient:
      "The Google connection does not currently carry enough permission to read this list. Disconnect and connect again, leaving the Gmail permission ticked on Google's screen.",
    browseRefused: "The processing service could not fetch the list for {{source}}.",
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
  },
};
