/**
 * English: the second language, for colleagues and auditors who do not read Vietnamese.
 *
 * `vi.ts` decides which keys exist; this file answers them. The two are kept in step by
 * `i18n.test.ts`, which compares key sets with plural suffixes stripped -- so the `_one`
 * forms below, which Vietnamese has no use for, are expected rather than drift.
 *
 * Most of this copy is the original wording the interface shipped with, which is why it
 * reads like prose written for the screen rather than like a translation of one.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

export const en = {
  app: {
    name: "Undercroft",
    caption: "Undercroft · control plane",
    signOut: "Sign out",
    release: "Version",
  },

  lang: {
    label: "Language",
    vi: "Tiếng Việt",
    en: "English",
    viShort: "VI",
    enShort: "EN",
  },

  nav: {
    sections: "Sections",
    customers: "Customers",
    sources: "Sources",
    lake: "Raw lake",
    people: "People",
    lockedTitle: "Choose a customer first",
    lockedHint: " — choose a customer first",
  },

  common: {
    loading: "Loading",
    notLoaded: "Not loaded",
    nothingToShow: "Nothing to show.",
  },

  signIn: {
    title: "Control plane",
    lead: "Connect your accounts and see what has been synced.",
    expired: "Your session ended. Sign in again to continue.",
    deniedHeading: "No access",
    denied:
      "That account does not have access. If you were invited, sign in with the exact address the invitation was sent to.",
    google: "Continue with Google",
    emailLabel: "Or sign in with a code",
    emailPlaceholder: "you@example.com",
    notSent: "Not sent",
    sending: "Sending…",
    sendCode: "Email me a code",
    codeLabel: "Six-digit code",
    codeHint: "If {{email}} has access, a code is on its way. It expires in ten minutes.",
    notSignedIn: "Not signed in",
    signingIn: "Signing in…",
    signIn: "Sign in",
    useAnotherAddress: "Use a different address",
    sendFailed: "Could not send a sign-in code. Try again.",
    codeFailed: "That code did not work. Ask for a new one.",
  },

  tenants: {
    title: "Member companies",
    lead: "Each customer’s data is stored and accessed separately. Open one to grant, scope or withdraw access to their accounts.",
    emptyTitle: "No customers yet",
    emptyBody:
      "A customer is the unit everything else hangs off: their connected accounts, their synced records, and who can see them.",
    caption_one: "{{count, number}} customer",
    caption_other: "{{count, number}} customers",
    colCustomer: "Customer",
    colReference: "Reference",
    colRole: "Your role",
    addHead: "Add",
    addNote:
      "Adding a customer isn’t available here yet — the control plane exposes no create endpoint. Tenants are provisioned out of band for now.",
    notLoaded: "The list of customers could not be loaded. Nothing has been changed.",
  },

  sources: {
    title: "Connected sources",
    none: "No sources are connected for this customer yet.",
    count_one: "{{count, number}} source on record.",
    count_other: "{{count, number}} sources on record.",
    grantsHead: "Grants",
    colSource: "Source",
    colStatus: "Status",
    notWired:
      "Connecting, scoping, disconnecting and running a sync from here are not wired yet — the control plane exposes the grant list but not those actions. Each source syncs on its own schedule in the meantime.",
    notLoaded:
      "This customer’s grants could not be loaded, or you do not have access to them. Nothing has been changed.",
  },

  lake: {
    head: "Lake",
    title: "Raw lake",
    lead: "What has actually landed for {{tenantId}}, before any transform.",
    emptyTitle: "Not available yet",
    emptyBody:
      "Browsing lake objects and their provenance needs endpoints the control plane does not expose yet. This section is in place for when it does.",
  },

  people: {
    title: "People",
    lead: "Who may see {{tenantId}}, and how they were invited.",
    emptyTitle: "Nobody has access yet",
    emptyBody:
      "Invite an address below. Whoever controls it can then sign in with Google or a one-time code — the invitation is what admits them.",
    caption_one: "{{count, number}} person with access",
    caption_other: "{{count, number}} people with access",
    colAddress: "Address",
    colRole: "Role",
    notLoaded: "The roster for {{tenantId}} could not be loaded. Nothing has been changed.",

    invitationsHead: "Invitations",
    noneWaiting: "No invitations are waiting to be accepted.",
    waitingCaption_one: "{{count, number}} waiting to be accepted",
    waitingCaption_other: "{{count, number}} waiting to be accepted",
    colInvitedAs: "Invited as",
    colExpires: "Expires",
    colWithdraw: "Withdraw",
    withdraw: "Withdraw",
    notWithdrawn: "Not withdrawn",

    inviteLabel: "Invite an address",
    invitePlaceholder: "colleague@example.com",
    inviteHint:
      "They must sign in with this exact address. An invitation is not a password — it grants nothing until they prove they control the mailbox.",
    roleLabel: "Role",
    roleViewer: "viewer — can look",
    roleMember: "member — can trigger a sync",
    roleAdmin: "admin — can connect accounts and invite",
    notInvited: "Not invited",
    invitedAndEmailed: "Invited {{email}}. They have been emailed.",
    invitedNotEmailedHeading: "Invited, but not emailed",
    invitedNotEmailed:
      "{{email}} can sign in now, but no email was sent — mail is not configured. Tell them to sign in with that exact address.",
    inviting: "Inviting…",
    sendInvitation: "Send invitation",
    adminOnly: "Only an admin of {{tenantId}} can invite someone.",
  },

  grant: {
    markGranted: "Granted",
    markPending: "Awaiting scope",
    markLapsed: "Reconnect needed",
    markAbsent: "Not granted",
    account: "Account",
    reads: "Reads",
    schedule: "Schedule",
    since: "Since",
    connect: "Connect {{name}}",
    chooseScope: "Choose what to sync",
    reconnect: "Reconnect {{name}}",
    changeScope: "Change what syncs",
    disconnect: "Disconnect",
    errata: "Errata",
    whatWeRead: "What we read",
    whatWeChange: "What we change",
  },

  grantState: {
    lapsedHeadline: "Reconnect needed",
    lapsedDetail:
      "The access we were granted has lapsed or been withdrawn. Nothing has been lost — reconnecting picks up where the last sync finished.",
    notConnectedHeadline: "Not connected",
    needsScopeHeadline: "Choose what to sync",
    needsScopeDetail: "Connected. Tell us which account to read before the first sync.",
    needsScopeDetailNamed: "Connected to {{account}}. Choose what to sync before the first run.",
    connectedHeadline: "Connected",
    connectedDetail: "Syncing on schedule.",
    actionConnect: "Connect",
    actionChoose: "Choose",
    actionReconnect: "Reconnect",
  },

  scope: {
    driveFolders_one: "PDFs in {{count, number}} selected folder",
    driveFolders_other: "PDFs in {{count, number}} selected folders",
    gmailWholeMailbox: "Headers and PDF attachments, whole mailbox",
    gmailLabels: "Headers and PDF attachments in {{labels}}",
  },

  when: {
    noExpiry: "No expiry recorded",
    lapsedYesterday: "Lapsed yesterday",
    lapsedDays_one: "Lapsed {{count, number}} day ago",
    lapsedDays_other: "Lapsed {{count, number}} days ago",
    expiresToday: "Expires today",
    expiresTomorrow: "Expires tomorrow",
    expiresInDays_one: "Expires in {{count, number}} day",
    expiresInDays_other: "Expires in {{count, number}} days",
    hourly: "Hourly",
    dailyAt: "Daily at {{time}} SGT",
  },

  verdict: {
    okLabel: "Reconciled",
    okDescription: "Checked against the source and matching.",
    mismatchLabel: "Mismatch",
    mismatchDescription: "Checked against the source and disagreeing.",
    unverifiedLabel: "Not verified",
    unverifiedDescription: "No evidence either way. Absence of a mismatch is not a match.",
  },

  source: {
    readOnly: "Nothing. Read-only access, and you can disconnect at any time.",
    hubspotReads: "Companies, contacts and deals from your CRM.",
    xeroReads: "Invoices, payments, credit notes and contacts from one organisation you choose.",
    gmailReads: "Message headers and PDF attachments from the mailbox you connect.",
    driveReads: "PDF documents inside the folders you select. No other folder is read.",
  },
};
