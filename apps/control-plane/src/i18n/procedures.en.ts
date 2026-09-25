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
  "connections.list": "A customer's sources and how each is connected.",
  "connections.get": "One source and how it is connected.",
  "connections.startOAuth": "Begin an OAuth grant; returns the URL to open in a browser. Admins.",
  "connections.browseScope":
    "What may be chosen for a source's scope: Gmail labels, Xero organisations, Google Drive folders with their paths and the file types present, or each HubSpot object's properties, the portal's own included. Admins.",
  "connections.setScope":
    "Set what a source reads. For HubSpot, the properties chosen for each object are read as well as the standard ones, never instead of them. Admins.",
  "connections.setToken": "Connect a source with a pasted token. Admins.",
  "connections.setCadence":
    "Set how often a source is read: hourly, every_6h, daily, paused, or custom with --cron, a five-field cron expression in Singapore time that fires at most every five minutes. Admins.",
  "connections.disconnect": "End a source's grant. Admins.",
  "keys.list": "The customer's ingest keys. Admins.",
  "keys.mint": "Mint an ingest key; its token is returned this once. Admins.",
  "keys.revoke": "Revoke an ingest key. Admins.",
  "people.members": "Who has access to the customer.",
  "people.invitations": "The open invitations.",
  "people.invite": "Invite an address with a role. Admins.",
  "people.revokeInvitation": "Withdraw an open invitation. Admins.",
  "people.setRole": "Change the role a member holds; never the last admin's. Admins.",
  "people.removeMember": "End a member's access; never the last admin's. Admins.",
  "lake.summary": "What has landed, per stream: counts and freshness.",
  "lake.records": "An entity's raw records. Admins.",
  "lake.documents": "A source's raw documents. Admins.",
  "lake.query": "Run one SELECT over the raw lake. Admins.",
  "lake.search": "Full-text search over the raw lake. Admins.",
  "lake.querySchema": "The tables and columns lake query can read. Admins.",
  "models.list": "The customer's dbt models.",
  "models.get": "One dbt model and its SQL.",
  "models.save": "Store a dbt model; runs nothing. Admins.",
  "models.delete": "Delete a dbt model. Admins.",
  "models.build": "Build one model with dbt and wait for the answer. Admins.",
  "models.reference": "Reference material for a model's author.",
  "bi.answer": "Answer a question definition. Members and above.",
  "bi.runQuestion": "Run a saved question with parameters.",
  "bi.compile": "Compile a question definition to SQL. Members and above.",
  "bi.schema": "The tables and columns reports can read.",
  "bi.questions.list": "The saved questions.",
  "bi.questions.get": "One saved question.",
  "bi.questions.answer": "A saved question's answer under parameters.",
  "bi.questions.save": "Save a question. Members and above.",
  "bi.questions.delete": "Delete a question. Members and above.",
  "bi.dashboards.list": "The dashboards.",
  "bi.dashboards.get": "One dashboard.",
  "bi.dashboards.save": "Save a dashboard. Members and above.",
  "bi.dashboards.delete": "Delete a dashboard. Members and above.",
  "dq.failures": "The rows a failed data-quality test stored. Admins.",
  "runs.list": "The ledger of runs, newest first.",
  "runs.get": "One run, with its refusals and dbt steps.",
  "runs.events": "What the worker is saying about a run.",
  "runs.trigger": "Read a source now. Admins.",
  "config.google": "The public half of the Google client, for the Drive picker.",
  health: "Whether the server is answering.",
};
