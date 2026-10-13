# Undercroft over MCP

The door for an agent whose host speaks the Model Context Protocol: claude.ai, Claude
Desktop, Claude Code and any other MCP client. The server is the control plane's own `/mcp`
route; every tool is one procedure, called as the person who connected.

## Connecting

The person connects, not you. They give their host `https://<their control plane>/mcp`, and
the host sends them through Undercroft's sign-in and a consent page, or they paste a personal
access token they minted on their account page. If no `undercroft` tools are listed, tell the
person to connect; the project's `docs/runbook/mcp-setup.md` has the steps for each host.

The connection carries a **grant** the person chose:

- `read` lists only the tools that read. A tool that writes is not offered at all.
- `write` lists every tool the person's role allows.

The grant never widens on your request. When the operation you need is not listed, or a call
is refused with `WRITES_DISABLED`, tell the person that the connection is read-only and that
they decide whether to reconnect with a write grant.

## Tools

A tool is named by its procedure's path with `.` as `_`: `models.check` is `models_check`,
`bi.questions.save` is `bi_questions_save`. Its input schema is the procedure's own. Its
annotations say what it does: `readOnlyHint` for a read, `destructiveHint` for an operation
that cannot be undone. Your host may ask the person to confirm a destructive tool; if it does
not, ask them yourself before calling it.

A tool not in the list does not exist for this connection. Calling a name nobody listed is a
protocol error (`-32602`), not a refusal to report.

## Results

A result carries a JSON text of the answer and the same answer in `structuredContent`, with a
list wrapped as `{ "items": [...] }`. Both are bounded: at most 50 items of any top-level list,
and each cut is named in a note -- an extra text block, and in `structuredContent` the field
`"undercroft/clipped"`. An answer still over 60 KB has its text cut there and no
`structuredContent` at all. The rest is not in the result anywhere you can read it. Never treat
a clipped list as all there is: call again with a narrower scope -- a filter, a smaller `limit`,
the next `cursor`, where the tool takes one -- or, for rows a person wants in a file, an export
(below).

A query result or a run's status may also render as a widget in the host. The widget shows
the person the whole answer, which can be more rows than you were sent; you do not need to
repeat every row, and you cannot quote a row you were not sent.

## Exports

An answer stops at 5,000 rows, and a tool result is not a file. When the person wants the rows
themselves -- a report's whole answer, or a dbt model's table -- in a file, call
`bi_exports_create` with a `source`:

- `{ "kind": "question", "questionId": "<uuid>" }` for a saved question, with its `params`;
- `{ "kind": "definition", "definition": { ... } }` for a definition, as `bi_answer` takes one;
- `{ "kind": "model", "model": "<name>" }` for a model's whole table.

It answers with a `url`, good for 15 minutes, which downloads a CSV of every row for the person
who asked and nobody else. Give the person the link: they open it in a browser where they are
signed in to Undercroft. If you have a shell, fetch it yourself with your own token
(`Authorization: Bearer`) or with `undercroft bi exports download`. Never copy rows from a tool
result into a file of your own: a figure you re-type is one nobody can check.

A builder question exports what it answers, its own row limit included; the whole of a table is
its model. A failed download is a broken file, never a short one: if the transfer is cut, ask
for the export again.

## Refusals

A refused call returns `isError: true` with a `structuredContent` of:

```json
{
  "code": "PERMISSION_DENIED",
  "message": "Thao tác này cần vai trò admin.",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

- `code` is the same vocabulary the CLI uses; `SKILL.md` says which to retry.
- `message` is the server's own sentence, in the person's language. Give it to them as it is.
- `details` holds the facts the server named, when it named any. `VALIDATION_FAILED` carries
  the schema's `issues`.
- A call a read-only grant does not allow is refused with the code `WRITES_DISABLED`.
- `traceId` identifies the request on the server. Quote it in a bug report.

An HTTP 401 means the connection's credential is no longer valid: revoked, expired or its
person removed. A 403 with `insufficient_scope` means the person granted neither read nor
write. Both are the person's to fix by connecting again.

## Skills over MCP

`/mcp` also serves these skills themselves through the MCP Skills extension
(`io.modelcontextprotocol/skills`): `skills/list`, `skills/get`, and each file through
`resources/read` at `skill://<name>/<path>`. They are the same files `npx skills add`
installs. If your host loaded this skill that way, it is already current for this server.
