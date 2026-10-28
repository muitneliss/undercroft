# 151. An agent's call is kept whole for a superadmin, for 30 days

- Status: Accepted
- Date: 2026-10-28
- Refines: [ADR 0120](0120-an-agents-reads-and-every-sign-in-event-are-on-the-record.md), whose
  audit row for an agent's call stays exactly as it is. This adds a second record of the same call,
  in a separate table, for a different reader. Nothing in
  [ADR 0113](0113-every-action-is-in-the-audit-log-and-people-can-read-it.md) or 0120 is
  superseded.
- Touches: [ADR 0058](0058-requests-are-traced-into-the-hosts-otel-lgtm.md), whose spans and log
  lines stay free of payloads. A row carries the trace id, so the two lead to each other.
  [ADR 0026](0026-full-text-search-over-the-raw-lake.md) section 3, which this keeps true.

## Context

When an agent's call goes wrong -- through the CLI, `/mcp` or the assistant -- a superadmin who is
asked why has three records, and none of them says what was sent:

- The **audit row** (ADR 0113, 0120) says who called which procedure and how it ended. It copies
  nothing of the input, because a customer's admin reads it, and SQL or a question may quote data
  that was not addressed to them. It is kept for ever.
- The **trace and its log lines** (ADR 0058) say where it failed and the exception's type. They
  carry no body and no message, because exception text routinely embeds the row that caused it.
- The **caller** was told `internal_error` for a 500, by design.

So "the agent sent X and got Y" was answered by asking the person to reproduce it.

## Decision

1. **A separate table, `ops.call_log`, written for every call through an agent's door** -- `cli`,
   `mcp`, `assistant` -- by the router's outermost middleware (`audited` in `trpc.ts`) and by
   `/mcp`'s refusal before the router, through one function (`keepCall` in
   `handlers/callPayload.ts`). This is independent of who writes the audit row. A call through
   the browser is never kept, for ADR 0120's reason: it polls, and its reads would bury an
   agent's. A row holds the request as sent, the answer, the error as the server saw it, the
   duration and the trace id.
2. **A platform superadmin reads it, and nobody else.** `audit.calls.list` pages the calls without
   their bodies. `audit.calls.get` reads one whole. Both are on `superadminProcedure`. A superadmin
   already holds `admin` in every customer (ADR 0013), so this gives them no reach they lacked.
   No customer's admin reads this table, which is why it can hold what `audit_log.detail` must
   not. The account page shows it at `?log=calls`, offered only to a superadmin.
3. **An answer carrying a customer's rows or document text is kept as its shape only.**
   `PAYLOAD_KEPT` in `handlers/callPayload.ts` is total over the router's procedures, so a new
   one is a `tsc` error until somebody decides. Each is `whole`, `shape` or `none`, or whole with
   named fields redacted. `shape` keeps an answer's columns (name and type), how many rows, items
   or hits, and the notes beside them -- `truncated`, the next cursor, qualifiers, rows limited --
   and never a cell, a raw payload, an excerpt or document text. The shape is an ALLOW-list of
   metadata keys (`SHAPE_KEPT` in `services/callLog.ts`). A key it does not name is dropped and
   named in `omitted`, so a field added to an answer later is dropped until somebody vouches for
   it. The procedures kept as shape, and why:
   - `lake.records`: a raw payload is the source's data verbatim.
   - `lake.query`: any SELECT over `raw`, `raw.document_text.text` included.
   - `lake.search`: every hit carries an excerpt.
   - `models.preview`: a model's rows.
   - `bi.answer`, `bi.runQuestion`, `bi.questions.answer`: rows of a customer's analytics.
   - `dq.failures`: the rows a failed test stored, which `dq_<slug>` keeps off dashboards.
   - `seeds.get`: every cell of a reference table a customer wrote.
   - `connections.browseScope`: the names of a customer's folders, labels and files, which
     `pii.md` keeps out of Postgres.

   `models.build` is kept whole except its `preview`. `lake.documents` is kept whole, because it
   holds what `raw.documents` holds: opaque ids, types, sizes and hashes.

   The reason is the one ADR 0026 section 3 gave for keeping `raw.document_text.text` from the
   control plane's login: it "would make a future bug in any control-plane handler a
   document-disclosure bug". `180_document_text.sql:66-72` says that "a request log is a far less
   controlled surface than this table", and `.claude/rules/pii.md` says "the column grant is the
   line: never give `undercroft_app` `text`". The same holds for every analytics and dq schema,
   which that login cannot read at all. A copy of the answer in a table the login reads and writes
   would be the denied grant by another name. So the control plane never holds a copy of what its
   login is denied.

4. **The request is kept for every procedure, SQL and questions included.** It is the agent's own
   words, not document text, and the reader is a superadmin alone, for 30 days. It may quote a
   customer's values -- `WHERE name = 'Acme'` -- and that is accepted: it is what the superadmin
   needs to see in order to reproduce the call.
5. **No secret is stored.** Two layers, both in the service that writes:
   - a deep, case-insensitive, exact-key deny-list (`token`, `accessToken`, `refreshToken`,
     `idToken`, `secret`, `clientSecret`, `password`, `apiKey`, `authorization`, `code_verifier`,
     `codeVerifier`) replaces the value with `[redacted]` wherever it sits, in the request and in
     the answer;
   - the table names each procedure's own secret field, typed against the procedure, so a rename
     is a `tsc` error: `connections.setToken`'s input `token`, `keys.mint`'s and
     `account.tokens.mint`'s output `token`.

   `audit.calls.*` keep no answer (`none`), so reading the log does not write it again.

6. **The error is kept as the server saw it.** That is its tRPC code, its status, the message and
   facts the caller got, and the cause underneath: name, message and stack. Server-side only. The
   wire still says `internal_error`. The message, the cause's message and its stack are each cut
   at 16 KB on a character boundary, and the facts pass the same secret-key deny-list as a body.
7. **Bounded.** A request and an answer are each cut at 256 KB on a UTF-8 character boundary. The
   row records the whole size and a `truncated` flag. A row older than 30 days is deleted: every
   thousandth insert sweeps the table (`call_log_pruned { removed }`). Writing never throws. A
   failure is logged as `call_log_failed` with the error's type alone, and the call's answer
   stands.
8. **Only the control plane may touch the table.** `650_call_log.sql` grants `undercroft_app`
   SELECT, INSERT and DELETE, and nothing else, to nobody else. BI holds USAGE on `ops` for
   `ops.run`, so the missing table grant is what keeps a dashboard off an agent's requests.
   `privileges.test.ts` pins both sides.

## Consequences

- An agent's call is now two rows: the audit row, permanent and readable by the customer's admin,
  and this one, 30 days and superadmin-only. The audit row is unchanged.
- From a row, `task obs:trace TRACE=<trace_id>` opens the spans and `task obs:logs FOR=<trace_id>`
  the lines. From a trace id in an issue, `audit.calls.list` filtered by the caller and the time
  finds the row. `.claude/skills/debug-trace/SKILL.md` describes both.
- An answer kept as its shape cannot be replayed from the row. Re-running the request, which is
  kept, reproduces it.
- The sweep runs only when rows are written. With no agent traffic, a row can outlive 30 days
  until the next thousandth call. An idle table is a small one, and a scheduled sweep would be a
  second moving part for no reader.
- `tenant_id` is the tenant the call NAMED, as sent, not the one attributed by ADR 0120's check.
  Nobody but a superadmin reads it, and the filter is a convenience, not a boundary.
- `audit.mine`, `audit.tenant` and `audit.all` admit a 19-digit cursor that overflows `bigint`
  and answers `internal_error`. The new procedures admit 18 digits. The old cursors are unchanged
  here.

## Options rejected

- **Copy the request and answer into `audit_log.detail`.** A customer's admin reads the audit log
  (ADR 0120's rejected option "Copy a read's input into `detail`" gives the reason), and it is
  kept for ever.
- **Keep every answer whole.** The control plane would hold copies of document text, analytics
  rows and dbt failures that its login is denied (ADR 0026 section 3). A control-plane bug would
  become a disclosure of data it never read.
- **Keep no answer at all.** "What was the agent told" is half the question. Most answers carry no
  customer data, and the shape still says how many rows came back and whether the answer was cut.
- **A deny-list of data keys for the shape.** The first field added to an answer would walk past
  it. An allow-list fails closed.
- **Log the bodies into Loki.** ADR 0058 keeps payloads out of spans and lines, and the
  observability stack is shared with the host's other projects and outlives any retention set
  here. Nor is this table the subsystem ADR 0039 declined, a process's stdout captured into a
  queryable store, which it called "a log ingestion and retention subsystem with a new PII surface
  over raw text". This is one table, one writer and one reader, bounded in size and age, and an
  answer that could carry a customer's raw text is kept as its shape.
- **Keep the browser's calls too.** ADR 0120's reason: the browser's polling would bury the
  agents' calls this is for.
- **A foreign key to the audit row.** Two writers would have to agree on an order, and a row must
  outlive a person removed or a customer deactivated. The trace id and the time join them.
- **Name the procedures `audit.calls` and `audit.call`.** `call` is a word tRPC reserves in a
  router, so the pair is `audit.calls.list` and `audit.calls.get`, as `bi.questions.*` is.
