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
  "tenants.get":
    "One customer, your role in it and the permissions that role holds, sorted: read it to learn what you may do.",
  "tenants.create": "Create a customer. Platform superadmins only.",
  "tenants.rename": "Correct a customer's display name.",
  "tenants.deactivate":
    "Deactivate a customer: every member loses access and every sync stops until it is reactivated. Nothing is deleted.",
  "tenants.reactivate":
    "Reactivate a deactivated customer: access and sync schedules return as they were.",
  "connections.list":
    'A customer\'s sources and how each is connected, with how much each scope chose, counted. names (sources) or match to narrow; include: ["config"] for every chosen name.',
  "connections.get": "One source and how it is connected.",
  "connections.startOAuth": "Begin an OAuth grant; returns the URL to open in a browser.",
  "connections.browseScope":
    "What may be chosen for a source's scope: Gmail labels, Xero organisations, Google Drive folders with their paths and the file types present, or each HubSpot object's properties, the portal's own included. parentId for one level of the folder or label tree (null for the top), query to search names and paths, limit and cursor to page; partial still says when the listing is incomplete.",
  "connections.setScope":
    "Set what a source reads. For HubSpot, the properties chosen for each object are read as well as the standard ones, never instead of them.",
  "connections.setToken": "Connect a source with a pasted token.",
  "connections.setCadence":
    "Set how often a source is read: hourly, every_6h, daily, paused, or custom with --cron, a five-field cron expression in Singapore time that fires at most every five minutes.",
  "connections.setResync":
    "Set how often a source's lists are read in full again, to catch edits its change filter misses: the same choices as set-cadence, paused (off) by default. A full re-read spends at most the spec's daily share of the provider's requests; what does not fit continues on the next run.",
  "connections.disconnect": "End a source's grant.",
  "keys.list": "The customer's ingest keys.",
  "keys.mint": "Mint an ingest key; its token is returned this once.",
  "keys.revoke": "Revoke an ingest key.",
  "people.members": "Who has access to the customer.",
  "people.invitations": "The open invitations.",
  "people.invite": "Invite an address with a role.",
  "people.revokeInvitation": "Withdraw an open invitation.",
  "people.setRole": "Change the role a member holds; never the last admin's.",
  "people.removeMember": "End a member's access; never the last admin's.",
  "roles.list":
    "Every role in the customer -- the four built-ins, then its own -- with the permissions each holds, how many people hold it and how many open invitations name it, and the permission catalogue. names or match to narrow by key.",
  "roles.get": "One role by key: its label, description, permissions and how many hold it.",
  "roles.save":
    "Define a role, or change one the customer defined: key, label, description and permissions from the catalogue. create refuses a key in use; identical content answers unchanged: true. Built-in roles cannot be saved, and you may give or take away only permissions you hold yourself.",
  "roles.delete":
    "Delete a role the customer defined, with every grant to it. Refused while anyone holds it or an open invitation names it, for a built-in, and for a role holding a permission you do not hold.",
  "grants.list":
    "The grants in the customer -- a permission, or reading one thing, given to a role or a person, with its expiry -- expired ones included and marked. role or email to narrow to one subject.",
  "grants.save":
    "Give a role (role) or a member (email), standing or until expiresAt, exactly one of: permission, one from the catalogue; or object, reading one thing -- model:<name>, raw:<source>/<entity>, raw:<source>/*, report:question:<id>, report:dashboard:<id>, or the whole with model:*, raw:*, report:*. A customer's own role reads only what it is granted. Saving the same grant again moves its expiry. You may grant only a permission you hold and what you can read yourself.",
  "grants.delete":
    "Take one grant away, by id. Only a grant of a permission you hold, or of something you can read yourself.",
  "grants.reach":
    'What a role (role), a member (email) or -- naming nobody -- you may do and read: permissions, and reach with models, raw and reports, each "all" or the named things. Ask it before a grant and after. Asking about a role or another person needs people:manage.',
  "audit.mine":
    "Your own actions, newest first: what you did, through which door, and how it ended.",
  "audit.tenant": "Every action taken in the customer, by anyone, newest first.",
  "audit.all": "Every action on the platform, newest first. Platform superadmins only.",
  "lake.summary":
    "What has landed, per stream: counts and freshness. Only the streams you can read.",
  "lake.records":
    "An entity's raw records, or the ones a run wrote. Only a stream you can read; any other is an empty page.",
  "lake.documents":
    "A source's raw documents, or the ones a run wrote. Only a source whose documents you can read; any other is an empty page.",
  "lake.query": "Run one SELECT over the raw lake.",
  "lake.search":
    "Full-text search over the raw lake. Each kind ranks only its newest matches, and the answer says when that cut any. Only in the streams you can read, narrowed before anything is ranked.",
  "lake.querySchema":
    "The tables and columns lake query can read; tables for exactly those, match for names containing a fragment (case-insensitive), columns: false for table names alone.",
  "documentKinds.list":
    "The customer's catalogue of document kinds, what is published, and how many documents a publish would classify.",
  "documentKinds.add":
    "Add a kind to the catalogue's draft; from the generic catalogue, or your own with a description.",
  "documentKinds.update": "Rewrite a kind's description in the catalogue's draft.",
  "documentKinds.remove": "Remove a kind from the catalogue's draft; other cannot be removed.",
  "documentKinds.initialise":
    "Draw the catalogue's first kinds from a sample of the customer's documents, as a run; publishes nothing.",
  "documentKinds.publish":
    "Publish the catalogue's draft, so every document is classified against it again.",
  "models.list":
    "The customer's dbt models with their last build: description (the author's, null when there is none), sqlSha256 and testsSha256 to compare a copy, and the column count, no SQL. names or match to narrow; include: [\"columns\"] for each build's columns, include: [\"dependsOn\"] for what each model declares it reads: reads (model, seed, raw or missing, with the macro via) and undeclared (why its upstream cannot be read; empty reads with undeclared reasons is not reading nothing); limit and cursor to page, which answers { items, nextCursor }. lastTests is what the tests of the published build serving each model's rows found: passing, failing (failing counts them) or unknown (no test record, never a pass); unpublished names a newer build held back because it or its tests failed, and runId null with unpublished set is a model with no passing version yet. Only the models and reference tables you can read.",
  "models.revision":
    "One hash for each of the customer's models, macros, reference tables and questions and one over all of them, from what each save wrote: equal means nothing changed.",
  "models.get":
    "One dbt model, its SQL, tests and description, with the hashes of its SQL and tests, and lastTests: passing, failing or unknown, with failingTests and warningTests by name, and unpublished: a newer build held back, whose rows Reports do not read. One you cannot read is NOT_FOUND.",
  "models.save":
    "Store a dbt model; runs nothing. tests: columns maps a column to not_null, unique, {kind: accepted_values, values, quote?} or {kind: relationships, to, field}; sql lists SQL tests {name, sql}, each a select of the rows that break a rule; any test takes severity error or warn. A SQL test or relationships that models.check finds an error in is refused and nothing is written. description is optional, at most 1000 characters and without { or }: left out it keeps the stored one, null clears it. The SQL, tests and description already stored answer unchanged: true and change nothing.",
  "models.delete":
    "Delete a dbt model with the tables it built, published and held back, and the rows its tests stored; deletes nothing if the table could not be dropped.",
  "models.build":
    "Build models in one dbt build: name for one model, or names for up to 20, each name, +name (with the models upstream) or name+ (with those downstream); every name must be one of the customer's models. Before it runs, the parents it reads without rebuilding are checked: one whose latest tests failed is PRECONDITION_FAILED naming the parent, its tests and the run (rebuild it, or build +name); one with no test record is named in parentTestsUnknown. By default it waits and answers waited true with ok, verdict (clean, tests-failing or failed: success is clean; ok with failing tests is tests-failing), testsFailed, stepSummary (counts by kind and status), the steps asked for (steps: none, problems by default, or all; narrow with stepStatus, stepKind, stepName; read the next page with runs.get on runId with stepCursor), rowCounts (each named model's rows; null means not counted, never 0) and preview when one model is named. A build is written to staging and only what built, passed its error-severity tests and whose parents in the build were published is published for Reports; each model step's promoted says whether it was, and a held model keeps its last passing version, so rowCounts and preview are null for it. wait false answers at once with waited false and runId; wait on that run with runs.get and waitSeconds. While another build runs it is a CONFLICT naming that run's runId and startedAt.",
  "models.lineage":
    "Which models read which models, reference tables and raw lake tables, from the models' and macros' own ref() and source() declarations. name for the part around one model, reference table or raw table (raw.records), direction up, down or both, and depth to bound the steps; limit and cursor to page, at most limit nodes and limit edges a page, with nextCursor. Only the models you can read, with their edges.",
  "models.reference":
    "Reference material for a model's author: the sources, the platform's macros and the customer's own. parts for only some of sources, platformMacros and tenantMacros; the first two are the same text on every call.",
  "models.check":
    "Check a model's SQL and its tests before saving it, running nothing: certain errors, suspicions, and what could not be checked; a finding in a test names it in test.",
  "models.preview":
    "See what a model returns before saving it: dbt compiles sql as the model name in the customer's project, in place of the saved model of that name or beside the others, and the SQL it compiled runs read-only. Answers columns, rows, truncated and compiled; query runs over the model instead and reads it by its name, to count its rows or its distinct keys. Saves and builds nothing. A model that does not compile is BAD_REQUEST with dbt's cause.",
  "macros.list":
    "The customer's own dbt macros, each with what it is for, its parameters and the hashes of its definition and description, no definition. names or match to narrow; limit and cursor to page, which answers { items, nextCursor }.",
  "macros.get": "One of the customer's dbt macros, its definition and their hashes.",
  "macros.check":
    "Check a macro's definition before saving it, running nothing: what would be refused, suspicions, and what could not be checked.",
  "macros.save":
    "Store a dbt macro, one whole {% macro %} definition that every model can call; runs nothing. The definition and description already stored answer unchanged: true and change nothing.",
  "macros.delete": "Delete a dbt macro; refused while a model or another macro calls it.",
  "seeds.list":
    "The customer's reference tables (dbt seeds), which models read with ref(): names, column and row counts and a hash of the content, no cells. names or match to narrow. Only the ones you can read.",
  "seeds.get":
    "One reference table whole: its columns with their declared types, every row with each cell a string or null, and its hash. One you cannot read is NOT_FOUND.",
  "seeds.save":
    "Store a small reference table: columns is [{name, type}] with type one of text, integer, bigint, numeric(18,4), boolean, date, timestamptz; rows are arrays of strings or null, one cell per column. No type is inferred: a cell its column cannot hold is refused, naming the row and column. At most 10,000 rows, 100 columns and 1 MB. A table identical to the stored one answers unchanged: true.",
  "seeds.delete":
    "Delete a reference table and the table loaded from it; refused while a model reads it by ref().",
  "bi.answer":
    "Answer a question definition: columns, rows and truncated, and qualifiers naming each table it read whose latest tests fail or are unknown, or whose current build was held back (unpublished: the rows are the last passing version) (null when the tables read are not known); rows are never withheld. A model with no passing version yet is PRECONDITION_FAILED naming it. As you: its SQL reads only the models you can read, and any other table is refused.",
  "bi.runQuestion":
    "Run a saved question with parameters; answers as bi.answer, qualifiers included.",
  "bi.compile": "Compile a question definition to SQL.",
  "bi.schema":
    "The tables and columns reports can read; tables for exactly those, match for names containing a fragment (case-insensitive), columns: false for table names alone. Only the tables of the models you can read.",
  "bi.questions.list":
    'The saved questions: kind, chart type and definitionSha256, no SQL. names or match to narrow; include: ["definition", "chart"] for either in full; limit and cursor to page, which answers { items, nextCursor }. Only the questions you can read.',
  "bi.questions.get": "One saved question. One you cannot read is NOT_FOUND.",
  "bi.questions.answer":
    "A saved question's answer under parameters, with qualifiers as bi.answer gives them.",
  "bi.questions.save": "Save a question.",
  "bi.questions.delete": "Delete a question.",
  "bi.dashboards.list": "The dashboards. Only the dashboards you can read.",
  "bi.dashboards.get":
    "One dashboard. One you cannot read is NOT_FOUND; ungranted names its tiles whose questions you may not open.",
  "bi.dashboards.save": "Save a dashboard.",
  "bi.dashboards.delete": "Delete a dashboard.",
  "bi.exports.create":
    "Export every row of a saved question, a definition or a dbt model as a CSV file; answers with a download link good for 15 minutes, to you alone. Open it in a browser signed in to Undercroft, or fetch it with `undercroft bi exports download`. Definitions and models need reports:author.",
  "bi.exports.get":
    "One export you asked for that has not expired: the SQL it runs and its file name.",
  "dq.failures": "The rows a failed data-quality test stored.",
  "runs.list":
    "The ledger of runs, newest first. Every filter is optional and combines with the others and with the cursor: one source, kind (one or several), status, trigger, parentRunId (the runs that run chained, such as the transform after an ingest), chained or not, startedAfter (inclusive) and startedBefore (exclusive), and up to 50 ids. Each run carries verdict: clean, tests-failing (ok, with failing tests), failed or running. An empty page means nothing matched.",
  "runs.get":
    "One run, with the scope it read with, its refusals and its verdict (clean, tests-failing, failed or running). Its dbt steps come as stepSummary (counts by kind and status; a skipped step stays skipped) plus the steps asked for: steps is none, problems (the default: every step that is not success, pass or skipped) or all; narrow with stepStatus, stepKind and stepName (a filter without steps means all) and page with stepCursor from nextStepCursor. waitSeconds (at most 50) answers as soon as the run is no longer running, and for an ingest that closed ok once its chained transform (childRun) exists; when the wait runs out it still says running. Use it instead of polling.",
  "runs.events": "What the worker is saying about a run.",
  "runs.trigger": "Read a source now.",
  "config.google": "The public half of the Google client, for the Drive picker.",
  "config.signIn": "The ways to sign in this server offers, for the sign-in page.",
  health: "Whether the server is answering.",
};
