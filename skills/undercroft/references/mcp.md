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

A result carries the whole answer in `structuredContent`, with a list wrapped as
`{ "items": [...] }`, and a JSON text of it for you to read. The text is clipped at 50 items
per list and 60 KB, and a clipped text says so in a note; the whole answer is still in
`structuredContent`. Never treat a clipped list as all there is.

A query result or a run's status may also render as a widget in the host. The widget shows
the person the same answer you have; you do not need to repeat every row.

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
