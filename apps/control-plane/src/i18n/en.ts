/**
 * English, for the colleagues and auditors who do not read Vietnamese.
 *
 * `vi.ts` decides which keys exist; this file answers them, and `index.ts` makes that a
 * typecheck rather than a hope. Most of this is the wording the control plane shipped with.
 */

import { modelCheck } from "./modelCheck.en.ts";
import { seedTable } from "./seedTable.en.ts";

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
    modelsRecoveredTestsFailing:
      "The model build for {{tenantId}} runs again, but some of its tests are failing",
    testsFailing: "Tests failing",
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

  permission: {
    reportsAuthor: "author questions and dashboards",
    modelsRead: "read models, macros and reference tables",
    modelsWrite: "save, build and preview models, macros and reference tables",
    lakeRead: "read the raw lake",
    runsRead: "read the journal of runs",
    sourcesRead: "read sources and their settings",
    sourcesManage: "manage sources",
    keysManage: "manage ingest keys",
    catalogueManage: "manage the document-kind catalogue",
    peopleManage: "manage people",
    auditRead: "read the customer's audit log",
    tenantManage: "manage the customer",
    rolesManage: "manage roles",
  },

  procedure: {
    needs: "Needs {{permission}}.",
    needsWholeReach: "Needs reading every model and the whole raw lake (model:*, raw:*).",
  },

  error: {
    notInvited:
      "That address has not been invited. Ask an administrator for an invitation, and sign in with the exact address it was sent to.",
    localSignInElsewhere: "Local sign-in works only at {{origin}}. Use that address instead.",
    alreadyMember: "{{email}} already has access as {{role}}.",
    noOpenInvitation: "No open invitation with that id.",
    notMember: "{{email}} does not have access to this customer.",
    lastAdmin:
      "{{email}} is this customer's only admin. Make someone else an admin first, so the customer is not left with nobody who can manage access.",
    requiresPermission:
      "This action needs permission to {{label}} ({{permission}}). Ask someone who holds people:manage in this customer for a role that has it.",
    permissionsNotHeld:
      "You can only give or take away permissions you hold yourself, and you do not hold {{permissions}}. Ask someone in this customer who holds them to make this change.",
    reachNotHeld:
      "You can only give or take away reading what you can read yourself, and you cannot read {{objects}}. Ask someone in this customer who can read them to make this change.",
    wholeReachRequired:
      "This runs SQL as the customer's build login, which reads every model and the whole raw lake, so it needs reading all of them ({{objects}}). Ask someone who holds roles:manage in this customer to grant it to you.",
    grantOneObject:
      "Name exactly one of permission, to grant something a person may do, or object, to grant reading one thing (model:…, raw:…, report:…).",
    grantObjectShape:
      "{{object}} is not an object a grant can name. Use model:<name> or model:*, raw:<source>/<entity>, raw:<source>/* or raw:*, report:question:<id>, report:dashboard:<id> or report:*.",
    grantRulesOneModel:
      "A row rule and hidden columns can only be set on reading one particular model (model:<name>), not on model:*, a permission, raw data or a report.",
    ruleEqualsOne: "An eq condition compares with exactly one value. For several values, use in.",
    grantUnknownColumn:
      "{{model}} has no column {{columns}}. Its columns, as its last build found them: {{known}}.",
    grantNoColumnsYet:
      "{{model}} has no columns on record because it has never built successfully, so a rule naming {{columns}} cannot be set yet. Build the model first.",
    grantChanged:
      "Someone else changed this grant while you were saving it, so nothing was written. Read it again (grants.list) and save again.",
    columnNotGranted:
      "Your access does not include some columns of {{model}} ({{columns}}), so the query was refused rather than leaving them blank. Select only the columns you need, and not SELECT *.",
    noSuchObject:
      "This customer has no {{object}}. models.list, seeds.list, bi.questions.list and bi.dashboards.list show what it has.",
    noSuchRole: "This customer has no role {{role}}. roles.list shows the roles it has.",
    builtInRole:
      "{{role}} is a built-in role: its permissions are the platform's and cannot be changed or deleted. Define a role of your own with the permissions you need.",
    roleKeyTaken: "There is already a role {{role}}. Edit that role, or choose another key.",
    roleInUse:
      "Role {{role}} was not deleted because it is in use. People holding it: {{members}}; open invitations at it: {{invitations}}. Move them to another role and revoke the invitations, then try again.",
    grantOneSubject:
      "Name exactly one of role, to grant to a role, or email, to grant to a person.",
    grantExpiryPassed:
      "The expiry {{expiresAt}} has already passed, so this grant would never hold. Choose a moment in the future, or leave it out for a grant that does not expire.",
    noSuchGrant: "This customer has no grant with that id.",
    requiresSuperadmin: "This action requires platform administrator access.",
    writesDisabled:
      "This token may only read, so it cannot do this. Mint a token that may write on the Account page if you mean to allow it.",
    requiresSession:
      "This can only be done from a signed-in browser (or the CLI signed in with an emailed code), never with a token.",
    tenantExists: "The tenant ID {{tenantId}} is already in use by another customer.",
    tenantDeactivated:
      "This customer is deactivated. Nothing in it can be used or synced until an admin reactivates it.",
    tenantNotDeactivated: "This customer is active; there is nothing to reactivate.",
    tenantRoleCollision:
      "The tenant ID {{tenantId}} is too close to another customer's (it differs only in case or punctuation). Choose one that differs in more than that.",
    documentKindExists:
      "This catalogue already has a kind named {{kind}}. Edit its description instead.",
    documentKindNeedsDescription:
      "{{kind}} is not in the generic catalogue, so it needs a description: the classifier is told what it means.",
    documentKindRequired:
      "{{kind}} cannot be removed. Without it every document would be forced into one of the other kinds.",
    documentKindsExist:
      "This catalogue already has kinds, and initialising again would re-add the ones you removed. Edit it instead.",
    documentKindsInitialising:
      "The catalogue is being initialised right now. Watch that run in the Journal.",
    documentKindsNotStarted:
      "The catalogue could not be initialised. The processing service did not answer; try again in a few minutes.",
    semanticNotConfigured:
      "Classifying documents is not configured: the processing service has no classifier key.",
    documentKindsEmpty:
      "The catalogue has no kind besides other, so publishing it would classify every document as nothing. Add a kind or initialise the catalogue first.",
    modelNameTaken:
      "A model named {{name}} already exists. Open it to edit, or choose another name.",
    modelNameIsSeed:
      "A reference table (seed) named {{name}} already exists. A model and a reference table may not share a name, since ref() reads either by that name. Choose another name.",
    modelTestRefused: "Nothing was saved. {{reason}} models.check shows every finding.",
    buildInProgress:
      "A build is already running for this customer. Wait for it to finish, then try again.",
    buildInProgressAs:
      "A build is already running for this customer: run {{runId}}, started {{startedAt}}. Wait for it to finish, then try again.",
    buildNamesOne: "Give exactly one of name, for one model, or names, for a list of models.",
    modelsNotFound:
      "This customer has no model named {{names}}. Check the names against the list of models; nothing was built.",
    buildNotStarted:
      "The model could not be built. The processing service did not answer; try again in a few minutes.",
    buildParentTestsFailing:
      "{{model}} was not built: the latest tests of its parent {{parent}} failed ({{tests}}, run {{runId}}), so building {{model}} now would copy those rows. Fix and rebuild {{parent}}, or build it with its parents as +{{model}}.",
    modelNotDeleted:
      "The model {{name}} was not deleted: the processing service could not drop the table it built, so the model is still here. Try again in a few minutes.",
    modelDependedOn:
      "The model {{name}} was not deleted: {{dependents}} read from its table. Delete those models, or change them so they no longer read {{name}} and build them again, then try again.",
    macroNameTaken:
      "A macro named {{name}} already exists. Open it to edit, or choose another name.",
    macroDependedOn:
      "The macro {{name}} was not deleted: it is still called by {{dependents}}. Remove those calls first, then try again.",
    seedNameTaken:
      "A reference table named {{name}} already exists. Save without create to replace it, or choose another name.",
    seedNameIsModel:
      "A model named {{name}} already exists. A reference table and a model may not share a name, since ref() reads either by that name. Choose another name.",
    seedDependedOn:
      "The reference table {{name}} was not deleted: {{dependents}} still read it. Change them so they no longer read {{name}}, then try again.",
    seedNotDeleted:
      "The reference table {{name}} was not deleted: the processing service could not drop the table loaded from it, so the reference table is still here. Try again in a few minutes.",
    dqNotRead: "The failing rows for this step could not be read.",
    lineageNameUnknown:
      "This customer's lineage has no model or table named {{name}}. A raw table is written as schema.table, such as raw.records.",
    tablesUnknown: "Not among this customer's tables: {{tables}}.",
    namesUnknown: "Not in this list of the customer's: {{names}}.",
    pageCursorUnknown:
      "This page cursor no longer matches {{procedure}}: the item it continues after is no longer listed. Read again from the first page, without a cursor.",
    noPassingVersion:
      "{{model}} has no passing version yet: its build in run {{runId}} failed its tests or did not build, so nothing of it is published for Reports. Fix the model and build it again.",
    queryFailed: "The query did not run: {{message}}",
    previewCompileFailed:
      "The model {{name}} did not compile, so nothing ran and nothing was saved: {{cause}}",
    previewNotRun:
      "The model could not be previewed. The processing service did not answer; try again in a few minutes.",
    queryNotRun:
      "The query could not be run. The processing service did not answer; try again in a few minutes.",
    searchNotRun:
      "The search could not be run. The processing service did not answer; try again in a few minutes.",
    searchTimedOut:
      "The search ran past its time limit and was stopped; running it again unchanged will stop again. Narrow it: search one kind (records or documents), add words, or put a phrase in quotes.",
    workerBusy:
      "This customer's database is busy (a model build, or many queries at once). Try again in a few seconds.",
    paramMissing: "The question needs a value for {{name}}. Set that filter and run again.",
    workerUnavailable:
      "The list could not be fetched from Google just now. The processing service did not answer; try again in a few minutes.",
    scopeInsufficient:
      "The {{source}} connection does not currently carry enough permission to read this list. Connect the source again, leaving every permission it asks for ticked on the consent screen.",
    credentialExpired:
      "The access granted to the {{source}} connection has expired or been revoked, so the list could not be fetched. Connect the source again, then come back to this screen.",
    browseRefused: "The processing service could not fetch the list for {{source}}.",
    browseUnsupported: "{{source}} has no list to choose what it reads from.",
    browseNotTree:
      "The {{source}} list is not a tree, so it cannot be browsed by parent. Leave out parentId.",
    browseParentUnknown:
      "The {{source}} list has no item with the id {{parentId}}. Use the id of a folder or label the list holds.",
    browseCursorUnknown:
      "This page cursor no longer matches the {{source}} list: the item it continues after is no longer listed. Browse again from the first page.",
    scopeNotUnderstood: "The selection for {{source}} could not be read.",
    cronFields:
      "A cron expression has exactly five fields: minute, hour, day of month, month, day of week.",
    cronInvalid: "The cron expression “{{cron}}” could not be read.",
    cronNever: "The cron expression “{{cron}}” never comes round.",
    cronTooFrequent:
      "The cron expression “{{cron}}” runs more often than every {{minutes}} minutes, faster than the scheduler ticks.",
    cronWithoutCustom:
      "Only a custom schedule takes a cron expression; choose “custom”, or leave the cron out.",
    resyncNothingToRead:
      "{{source}} reads no list through a change filter, so there is nothing a full re-sync would catch up on.",
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

  modelCheck,

  seedTable,

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
      "This answer holds {{shown}} of the {{total}} items in {{field}}. The rest was not sent: call again with a narrower scope (a filter, a limit or a cursor, where the tool takes one) to read it.",
    textClipped:
      "This answer was cut at {{kilobytes}} KB and has no structuredContent. The rest was not sent: call again with a narrower scope (a filter, a limit or a cursor, where the tool takes one) to read it.",
  },
  export: {
    unnamed: "Result",
    signIn:
      "Sign in to Undercroft in this browser, then open the link again. Only the person who asked for it can download it.",
    notFound:
      "There is no such export. A link expires after {{minutes}} minutes and works only for the person who asked for it; ask for the export again.",
  },
  cli: {
    absent:
      "No CLI is served at this address. A server built from a release serves its own CLI at /cli/undercroft-cli.tgz; one started from a source checkout serves none.",
  },
};
