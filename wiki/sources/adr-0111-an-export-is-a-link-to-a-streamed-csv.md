---
title: ADR 0111 An Export Is a Link to a Streamed CSV
type: source
date: 2026-10-06
tags: []
source: docs/adr/0111-an-export-is-a-link-to-a-streamed-csv.md
source_path: docs/adr/0111-an-export-is-a-link-to-a-streamed-csv.md
source_hash: dae2123a6c346b73493e13db649818beaa0c2026641d1d47f0b30f51fe11b7c1
ingested: 2026-10-06
---

# ADR 0111 An Export Is a Link to a Streamed CSV

A person can take every row of a report's answer, or of a dbt model's whole table, as a CSV file. An answer stops at `MAX_QUERY_ROWS` (5,000) with no offset, a `/mcp` result is one JSON message a host cannot save as a file (clipped for the model at 50 items and 60 KB), and MCP streams only progress and log messages, never a result ([[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]]). So an export is asked for through the router and downloaded from a link.

`bi.exports.create` takes a source -- a saved question, a definition as `bi.answer` takes one, or a model -- and its parameters, compiles and binds the SQL with the contract's one compiler, stores it in `app.bi_export` (`490_bi_export.sql`) for the person who asked, and answers with `/api/exports/<tenantId>/<id>`, made whole at `UNDERCROFT_PUBLIC_URL` when configured. A builder question exports what it answers, its own `LIMIT` included; a model exports `SELECT * FROM "<model>"`. A saved question is any member's to export, a definition or a model a member's; the download reads the export back through `bi.exports.get` by `appRouter.createCaller(ctx)`, so the 404-not-403 boundary, a deactivated tenant ([[ADR 0110 A Tenant Can Be Deactivated]]), the grant and the role are asked again. `bi.exports.create` is a `read` in `EFFECTS`.

The link is not a credential: the download admits the person's own cookie or bearer on that request and answers only the person who asked; a request carrying `Authorization` is admitted by the bearer door only, so a live cookie never rescues a failed bearer. The row lives fifteen minutes (an INSERT from the database clock, a CHECK of at most an hour, swept by the next insert) and holds the SQL, its kind and a file name, never a row.

The worker streams it: `POST /v1/queries/export` runs the SQL as the tenant's BI login in the read-only frame, through one cursor (`DECLARE … NO SCROLL CURSOR`, `FETCH 1000`), one snapshot however long, encoded by the shared CSV encoder now in `@undercroft/contracts/csv` (figures as sent, missing empty, formulas neutralised by column type, a byte-order mark). Refusals come before the first byte (400 `query_failed`, 503 busy); a failure after it errors the stream, which Bun turns into a reset the control plane passes on, so a client sees a failed download rather than a short file. Exports take a turn (`turns.export`, four at once, ten seconds' wait) because each holds a pooled connection ([[ADR 0088 Tenant Logins Reach Postgres Through A Pooler And Runs Take A Turn]]); one FETCH may run two minutes, an export ten. Only the two long routes lift Bun's ten-second idle timeout (`liftIdleTimeout`). The CLI's `undercroft bi exports download <link> --out <file>` writes to `<out>.partial` and renames only on a clean end, and refuses a link to another origin before sending its session ([[ADR 0044: An agent reaches Undercroft as a caller]]).

Logged as `export_download` and `export_cut`, audited as `bi.export.create`, none carrying SQL, a file name or a row. Rejected: streaming rows over MCP, paging `bi.answer` by offset, a capability URL usable without a credential, building or storing the file in the control plane (it holds no tenant login, [[ADR 0016 The Worker Seals the Control Plane Consents]]), SQL in the link's query string, and raising `MAX_QUERY_ROWS`.
