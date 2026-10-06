# 111. An export is a link to a streamed CSV

- Status: Accepted
- Date: 2026-10-06
- Builds on: [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md) (`/mcp`, served
  statelessly, a person's own bearer), [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md)
  (the CLI is a caller), [ADR 0016](0016-the-worker-seals-the-control-plane-consents.md) (the control plane
  holds no tenant login), [ADR 0088](0088-tenant-logins-reach-postgres-through-a-pooler-and-runs-take-a-turn.md) (the
  pooler's limits and the timeout chain).

## Context

A person wants the rows behind a report, or a model's whole table, in a file. Nothing gave it to
them past 5,000 rows:

- `bi.answer` and a saved question's answer stop at `MAX_QUERY_ROWS` (5,000) and have no offset.
  The browser's CSV is built from the rows on screen, so it stops there too, and says so.
- Over `/mcp` a result is one JSON answer, stored whole in `structuredContent` and clipped for the
  model at 50 items and 60 KB. A host puts it in the conversation; it has no way to save it as a
  file, and a model that re-typed the rows into one could change a figure without anyone seeing.
- MCP itself would stream only progress and log messages, not a result. `/mcp` sends neither,
  and holds no session to push anything on (ADR 0060).
- `lake.query` pages with `offset`, but over the raw lake, for an admin, and a page of a query
  with no `ORDER BY` can repeat or skip a row.

## Decision

**An export is asked for through the router and downloaded from a link.**

1. **`bi.exports.create`** takes a source -- a saved question, a definition as `bi.answer` takes
   one, or a model -- and its parameters. It compiles and binds the SQL with the contract's one
   compiler, stores it in `app.bi_export` for the person who asked, and answers with a link,
   `/api/exports/<tenantId>/<id>`, whole at `UNDERCROFT_PUBLIC_URL` when one is configured. A
   builder question exports what it answers, its own `LIMIT` included; a model exports its whole
   table (`SELECT * FROM "<model>"`).
2. **Who may is the router's, asked twice.** A saved question is any member's to export, as its
   answer is; a definition or a model is SQL an author chooses, so a member's. The download reads
   the export back through `bi.exports.get`, by `appRouter.createCaller(ctx)`, so the 404-not-403
   boundary, a deactivated tenant (ADR 0110), the grant and the role are asked again when the rows
   are taken. `bi.exports.create` is a `read` in `EFFECTS`: a read grant may export what it may
   already read.
3. **The link is not a credential.** The download admits the person's own cookie or bearer, read
   on that request, and answers only the person who asked (`user_id` is in the `WHERE`). A request
   with an `Authorization` header is admitted by the bearer door only, so a live cookie never
   rescues a bearer that failed. A person in claude.ai opens the link in a browser where they are
   signed in; an agent fetches it with its token; the CLI with its session.
4. **The link lives fifteen minutes.** `expires_at` is set by the INSERT from the database's clock,
   a CHECK holds every writer to an hour, and the next export asked for sweeps the expired rows.
   The row holds the SQL, its kind and a file name, never a row of the answer.
5. **The worker streams it.** `POST /v1/queries/export` runs the SQL as the tenant's BI login in
   the same read-only frame as an answer, through one cursor (`DECLARE … NO SCROLL CURSOR`,
   `FETCH 1000`), so the file is one snapshot however long. Each batch is encoded by the CSV
   encoder the browser uses, moved to `@undercroft/contracts/csv`: a figure as the database sent
   it, missing as an empty field, a formula neutralised by the column's type, a byte-order mark.
   The control plane passes the body on unread.
6. **A refusal comes before the first byte; a failure after it cuts the body.** The worker
   declares the cursor and fetches the first batch before it answers, so bad SQL is a 400 with
   Postgres's sentence and no turn or connection in time is a 503. After the first byte, anything
   that fails -- a division by zero at row 40,000, the ten-minute deadline, the worker stopping --
   errors the stream. Bun then resets the connection, and the control plane passes the reset on,
   so a client sees a failed download, not a short file that reads as the whole answer (measured
   against Bun 1.4.2, through both servers). The CLI writes to `<out>.partial` and renames it only
   when the body ended cleanly.
7. **An export takes a turn.** It holds one of the login's eight pooled connections and an open
   transaction for as long as the reader takes, so the worker runs four at once (`turns.export`),
   the next waits ten seconds and is then told the worker is busy. One FETCH may run two minutes,
   the whole export ten.
8. **The two long requests lift Bun's idle timeout, and nothing else does.** Both servers keep the
   ten-second default; the worker's export route and the control plane's download lift it for
   that request alone (`liftIdleTimeout`), because a first batch can take minutes to compute.
9. **The CLI saves a link to a file.** `undercroft bi exports download <link> --out <file>` fetches
   it with the profile's session and refuses, before any request, a link to another origin: the
   session is only ever sent to the server that issued it.

## Consequences

- Every door exports the same way: `/mcp` lists `bi_exports_create`, the CLI has
  `bi exports create` and `bi exports download`, and the browser can follow the link it gets.
- A person in a chat must be signed in to Undercroft in the browser that opens the link. A link
  pasted to someone else answers them with 404.
- The download is logged as `export_download` with the export's id and the credential, and a cut
  as `export_cut` with the error's type. Creating one is audited as `bi.export.create`. None of
  them carries SQL, a file name or a row.
- A worker deploy cuts an export in flight, visibly, like any other failure after the first byte.
- Duplicate column names in one SELECT still collapse to one value per row, exactly as in an
  answer; the runner keys a row by column name.

## Options rejected

- **Stream the rows over MCP.** MCP streams progress and log notifications, not a result; a
  result is one message. It would also put every row into the model's context, where a host
  cannot save it and a model can alter it.
- **Page through `bi.answer` with an offset.** Every page is a new snapshot, and without an
  `ORDER BY` there is nothing for an offset to count against: rows repeat or go missing between
  pages, silently. One cursor in one transaction has neither problem.
- **A capability URL that works without a credential.** It would survive in a chat transcript,
  a proxy log or a browser history, and keep working for whoever found it after the person's
  token was revoked. Requiring the person's own credential keeps ADR 0060's rule that revoking
  takes effect at the next request.
- **Build the file in the control plane, or store it.** The control plane holds no tenant login
  (ADR 0016), and a stored file is a copy of customer data with a lifetime of its own. The rows go
  from Postgres to the person and stay nowhere.
- **The link carries the SQL in its query string.** A definition can be 64 KB, and a URL lands in
  access logs with every literal in it.
- **Raise `MAX_QUERY_ROWS`.** It bounds a JSON answer that is held in memory and drawn on a
  screen; an export has no reason to share that bound or that shape.
