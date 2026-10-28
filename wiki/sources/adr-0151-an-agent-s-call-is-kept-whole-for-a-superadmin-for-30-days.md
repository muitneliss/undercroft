---
title: ADR 0151 An Agent's Call Is Kept Whole for a Superadmin for 30 Days
type: source
date: 2026-10-28
tags: []
source: docs/adr/0151-an-agents-call-is-kept-whole-for-a-superadmin-for-30-days.md
source_path: docs/adr/0151-an-agents-call-is-kept-whole-for-a-superadmin-for-30-days.md
source_hash: b93c9d5becac4e811cba2215dd053904ed7ed939d79bd0b806138e539d5f1a2d
ingested: 2026-10-28
---

# ADR 0151 An Agent's Call Is Kept Whole for a Superadmin for 30 Days

Refines [[ADR 0120 An Agent's Reads, and Every Sign-In Event, Are on the Record]], whose audit row for an agent's call is unchanged; nothing in [[ADR 0113 Every Action Is in the Audit Log and People Can Read It]] or 0120 is superseded. Touches [[ADR 0058: Every request is traced, into the host's shared otel-lgtm stack]], whose spans and lines stay free of payloads, and keeps [[ADR 0026: Full-text search over the raw lake]] section 3 true.

**Why.** When an agent's call went wrong, a superadmin had the audit row (who, which procedure, how it ended, nothing of the input -- a customer's admin reads it, and it is kept for ever), the trace and its lines (where, and the exception's type, never a body or message), and a caller told `internal_error`. None said what was sent.

**Decision.** A separate table, `ops.call_log` (`650_call_log.sql`), written for every call through `cli`, `mcp` or `assistant` -- never `web` -- by the router's outermost middleware and by `/mcp`'s refusal before the router, through one function (`keepCall`, `handlers/callPayload.ts`), independent of the audit row. It holds the request as sent, the answer, the error as the server saw it (code, status, message, facts, and the cause's name, message and stack -- server-side only), the duration and the trace id. Only a platform superadmin reads it: `audit.calls.list` (no bodies) and `audit.calls.get` (one whole), on `superadminProcedure`; a superadmin already holds admin everywhere ([[ADR 0013 Superadmins Named in the Environment]]). The account page shows it at `?log=calls`.

**Shape, not cells.** `PAYLOAD_KEPT` is total over the router: each procedure is `whole`, `shape`, `none`, or whole with named secret fields redacted. `shape` keeps columns (name, type), counts of rows/items/hits and notes (`truncated`, cursors, qualifiers, rows limited) -- an allow-list of metadata keys (`SHAPE_KEPT`, `services/callBody.ts`); any other key is dropped and named in `omitted`. Shape for `lake.records`, `lake.query`, `lake.search`, `models.preview`, `bi.answer`, `bi.runQuestion`, `bi.questions.answer`, `dq.failures`, `seeds.get`, `connections.browseScope`; `models.build` whole but its `preview`; `lake.documents` whole (opaque metadata). The reason: the control plane's login is denied `raw.document_text.text` and every analytics and dq schema (ADR 0026 section 3, `180_document_text.sql:66-72`, `pii.md`), and a copy here would be that grant by another name.

**Requests, secrets, bounds.** The request is kept for every procedure, SQL included -- the agent's own words, read by a superadmin alone for 30 days; it may quote customer values, accepted. A deep, case-insensitive exact-key deny-list (`token`, `accessToken`, `refreshToken`, `idToken`, `secret`, `clientSecret`, `password`, `apiKey`, `authorization`, `code_verifier`, `codeVerifier`) redacts everywhere; the table also names `connections.setToken`'s input `token` and `keys.mint`'s and `account.tokens.mint`'s output `token`, typed so a rename is a `tsc` error; `audit.calls.*` keep no answer. Each body is cut at 256 KB on a UTF-8 boundary with its whole size and a flag; the error's message, cause message and stack are cut at 16 KB each, and its facts pass the deny-list; every thousandth insert deletes rows older than 30 days (`call_log_pruned`). Writing never throws (`call_log_failed`, error type only). Only `undercroft_app` holds SELECT, INSERT, DELETE; BI's USAGE on `ops` reaches nothing here.

**Consequences.** An agent's call is two rows: the permanent audit row and this 30-day one. A row's `traceId` leads to `task obs:trace`; a trace's caller and time lead to `audit.calls.list`. A shape cannot be replayed; the kept request can. With no agent traffic a row can outlive 30 days until the next sweep. `tenant_id` is the tenant the call named, unattributed. The older `audit.*` cursors admit a 19-digit value that overflows `bigint`; the new ones admit 18.

**Rejected.** Copying into `audit_log.detail` (a customer's admin reads it, for ever); keeping every answer whole (copies of what the login is denied); keeping no answer; a deny-list of data keys (fails open); logging bodies into Loki, and the stdout-ingestion subsystem [[ADR 0039 A Count Has a Route to Its Constituents]] declined; keeping the browser's calls; a foreign key to the audit row; naming them `audit.calls`/`audit.call`, since tRPC reserves `call`.
