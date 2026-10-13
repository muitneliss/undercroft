/**
 * English, the second language: one sentence per router procedure. See `procedures.vi.ts`.
 */

import type { SentenceTable } from "../handlers/surface.ts";

export const procedureSentences: SentenceTable = {
  "session.me": "Who you are on this server.",
  "session.signOut": "End the current session on the server.",
  "session.setLocale": "Remember the language you read, for emails sent while no page is open.",
  "account.tokens.list":
    "Your personal access tokens. Callable from a signed-in session only, never with a token.",
  "account.tokens.mint":
    "Mint a personal access token, read-only or read and write, expiring within 365 days; the token is returned this once. Signed-in session only.",
  "account.tokens.revoke": "Revoke one of your personal access tokens. Signed-in session only.",
  "account.apps.list":
    "The apps (such as a Claude connector) you let in by signing in and consenting, with the grant each holds. Signed-in session only.",
  "account.apps.revoke":
    "Revoke a connected app; it is refused from its next call. Signed-in session only.",
  "tenants.list": "The customers you have access to.",
  "tenants.get": "One customer, and your role in it.",
  "tenants.create": "Create a customer. Platform superadmins only.",
  "tenants.rename": "Correct a customer's display name. Tenant admins.",
  "tenants.deactivate":
    "Deactivate a customer: every member loses access and every sync stops until it is reactivated. Nothing is deleted. Tenant admins.",
  "tenants.reactivate":
    "Reactivate a deactivated customer: access and sync schedules return as they were. Tenant admins.",
  "connections.list":
    'A customer\'s sources and how each is connected, with how much each scope chose, counted. names (sources) or match to narrow; include: ["config"] for every chosen name.',
  "connections.get": "One source and how it is connected.",
  "connections.startOAuth": "Begin an OAuth grant; returns the URL to open in a browser. Admins.",
  "connections.browseScope":
    "What may be chosen for a source's scope: Gmail labels, Xero organisations, Google Drive folders with their paths and the file types present, or each HubSpot object's properties, the portal's own included. parentId for one level of the folder or label tree (null for the top), query to search names and paths, limit and cursor to page; partial still says when the listing is incomplete. Admins.",
  "connections.setScope":
    "Set what a source reads. For HubSpot, the properties chosen for each object are read as well as the standard ones, never instead of them. Admins.",
  "connections.setToken": "Connect a source with a pasted token. Admins.",
  "connections.setCadence":
    "Set how often a source is read: hourly, every_6h, daily, paused, or custom with --cron, a five-field cron expression in Singapore time that fires at most every five minutes. Admins.",
  "connections.setResync":
    "Set how often a source's lists are read in full again, to catch edits its change filter misses: the same choices as set-cadence, paused (off) by default. A full re-read spends at most the spec's daily share of the provider's requests; what does not fit continues on the next run. Admins.",
  "connections.disconnect": "End a source's grant. Admins.",
  "keys.list": "The customer's ingest keys. Admins.",
  "keys.mint": "Mint an ingest key; its token is returned this once. Admins.",
  "keys.revoke": "Revoke an ingest key. Admins.",
  "people.members": "Who has access to the customer. Admins.",
  "people.invitations": "The open invitations. Admins.",
  "people.invite": "Invite an address with a role. Admins.",
  "people.revokeInvitation": "Withdraw an open invitation. Admins.",
  "people.setRole": "Change the role a member holds; never the last admin's. Admins.",
  "people.removeMember": "End a member's access; never the last admin's. Admins.",
  "audit.mine":
    "Your own actions, newest first: what you did, through which door, and how it ended.",
  "audit.tenant": "Every action taken in the customer, by anyone, newest first. Admins.",
  "audit.all": "Every action on the platform, newest first. Platform superadmins only.",
  "lake.summary": "What has landed, per stream: counts and freshness.",
  "lake.records": "An entity's raw records, or the ones a run wrote. Admins.",
  "lake.documents": "A source's raw documents, or the ones a run wrote. Admins.",
  "lake.query": "Run one SELECT over the raw lake. Admins.",
  "lake.search":
    "Full-text search over the raw lake. Each kind ranks only its newest matches, and the answer says when that cut any. Admins.",
  "lake.querySchema":
    "The tables and columns lake query can read; tables for exactly those, match for names containing a fragment (case-insensitive), columns: false for table names alone. Admins.",
  "documentKinds.list":
    "The customer's catalogue of document kinds, what is published, and how many documents a publish would classify.",
  "documentKinds.add":
    "Add a kind to the catalogue's draft; from the generic catalogue, or your own with a description. Admins.",
  "documentKinds.update": "Rewrite a kind's description in the catalogue's draft. Admins.",
  "documentKinds.remove":
    "Remove a kind from the catalogue's draft; other cannot be removed. Admins.",
  "documentKinds.initialise":
    "Draw the catalogue's first kinds from a sample of the customer's documents, as a run; publishes nothing. Admins.",
  "documentKinds.publish":
    "Publish the catalogue's draft, so every document is classified against it again. Admins.",
  "models.list":
    "The customer's dbt models with their last build: sqlSha256 and testsSha256 to compare a copy, and the column count, no SQL. names or match to narrow; include: [\"columns\"] for each build's columns. lastTests is what the tests of the build serving each model's rows found: passing, failing (failing counts them) or unknown (no test record, never a pass).",
  "models.revision":
    "One hash for each of the customer's models, macros and questions and one over all of them, from what each save wrote: equal means nothing changed.",
  "models.get":
    "One dbt model, its SQL and tests, with their hashes, and lastTests: passing, failing or unknown, with failingTests and warningTests by name.",
  "models.save":
    "Store a dbt model; runs nothing. The SQL and tests already stored answer unchanged: true and change nothing. Admins.",
  "models.delete":
    "Delete a dbt model with the table it built and the rows its tests stored; deletes nothing if the table could not be dropped. Admins.",
  "models.build":
    "Build models in one dbt build: name for one model, or names for up to 20, each name, +name (with the models upstream) or name+ (with those downstream); every name must be one of the customer's models. Before it runs, the parents it reads without rebuilding are checked: one whose latest tests failed is PRECONDITION_FAILED naming the parent, its tests and the run (rebuild it, or build +name); one with no test record is named in parentTestsUnknown. By default it waits and answers waited true with ok, verdict (clean, tests-failing or failed: success is clean; ok with failing tests is tests-failing), testsFailed, stepSummary (counts by kind and status), the steps asked for (steps: none, problems by default, or all; narrow with stepStatus, stepKind, stepName; read the next page with runs.get on runId with stepCursor), rowCounts (each named model's rows; null means not counted, never 0) and preview when one model is named. wait false answers at once with waited false and runId; wait on that run with runs.get and waitSeconds. While another build runs it is a CONFLICT naming that run's runId and startedAt. Admins.",
  "models.lineage":
    "Which models read which models and raw lake tables, from the models' and macros' own ref() and source() declarations. name for the part around one model or raw table (raw.records), direction up, down or both, and depth to bound the steps.",
  "models.reference":
    "Reference material for a model's author: the sources, the platform's macros and the customer's own. parts for only some of sources, platformMacros and tenantMacros; the first two are the same text on every call.",
  "models.check":
    "Check a model's SQL before saving it, running nothing: certain errors, suspicions, and what could not be checked.",
  "macros.list":
    "The customer's own dbt macros, each with what it is for, its parameters and the hashes of its definition and description, no definition. names or match to narrow.",
  "macros.get": "One of the customer's dbt macros, its definition and their hashes.",
  "macros.check":
    "Check a macro's definition before saving it, running nothing: what would be refused, suspicions, and what could not be checked.",
  "macros.save":
    "Store a dbt macro, one whole {% macro %} definition that every model can call; runs nothing. The definition and description already stored answer unchanged: true and change nothing. Admins.",
  "macros.delete": "Delete a dbt macro; refused while a model or another macro calls it. Admins.",
  "bi.answer":
    "Answer a question definition: columns, rows and truncated, and qualifiers naming each table it read whose latest tests fail or are unknown (null when the tables read are not known); rows are never withheld. Members and above.",
  "bi.runQuestion":
    "Run a saved question with parameters; answers as bi.answer, qualifiers included.",
  "bi.compile": "Compile a question definition to SQL. Members and above.",
  "bi.schema":
    "The tables and columns reports can read; tables for exactly those, match for names containing a fragment (case-insensitive), columns: false for table names alone.",
  "bi.questions.list":
    'The saved questions: kind, chart type and definitionSha256, no SQL. names or match to narrow; include: ["definition", "chart"] for either in full.',
  "bi.questions.get": "One saved question.",
  "bi.questions.answer":
    "A saved question's answer under parameters, with qualifiers as bi.answer gives them.",
  "bi.questions.save": "Save a question. Members and above.",
  "bi.questions.delete": "Delete a question. Members and above.",
  "bi.dashboards.list": "The dashboards.",
  "bi.dashboards.get": "One dashboard.",
  "bi.dashboards.save": "Save a dashboard. Members and above.",
  "bi.dashboards.delete": "Delete a dashboard. Members and above.",
  "bi.exports.create":
    "Export every row of a saved question, a definition or a dbt model as a CSV file; answers with a download link good for 15 minutes, to you alone. Open it in a browser signed in to Undercroft, or fetch it with `undercroft bi exports download`. Definitions and models: members and above.",
  "bi.exports.get":
    "One export you asked for that has not expired: the SQL it runs and its file name.",
  "dq.failures": "The rows a failed data-quality test stored. Admins.",
  "runs.list":
    "The ledger of runs, newest first. Every filter is optional and combines with the others and with the cursor: one source, kind (one or several), status, trigger, parentRunId (the runs that run chained, such as the transform after an ingest), chained or not, startedAfter (inclusive) and startedBefore (exclusive), and up to 50 ids. Each run carries verdict: clean, tests-failing (ok, with failing tests), failed or running. An empty page means nothing matched.",
  "runs.get":
    "One run, with the scope it read with, its refusals and its verdict (clean, tests-failing, failed or running). Its dbt steps come as stepSummary (counts by kind and status; a skipped step stays skipped) plus the steps asked for: steps is none, problems (the default: every step that is not success, pass or skipped) or all; narrow with stepStatus, stepKind and stepName (a filter without steps means all) and page with stepCursor from nextStepCursor. waitSeconds (at most 50) answers as soon as the run is no longer running, and for an ingest that closed ok once its chained transform (childRun) exists; when the wait runs out it still says running. Use it instead of polling.",
  "runs.events": "What the worker is saying about a run.",
  "runs.trigger": "Read a source now. Admins.",
  "config.google": "The public half of the Google client, for the Drive picker.",
  "config.signIn": "The ways to sign in this server offers, for the sign-in page.",
  health: "Whether the server is answering.",
};
