# The `undercroft` CLI contract

What an agent can rely on. The CLI's source decides this, in
`apps/cli/src/services/output.ts`, and this page states it for a reader.

## The envelope

In agent mode, stdout holds exactly one JSON document per invocation, then a newline, and
nothing else. Agent mode is `--agent`, `--json`, or any run whose stdin or stdout is not a
terminal.

Success:

```json
{ "ok": true, "data": { "runId": "run-01J9ZQ4" } }
```

When `data` is an array, `meta.count` is its length:

```json
{ "ok": true, "data": [{ "id": "CASE-0042", "displayName": "Acme" }], "meta": { "count": 1 } }
```

`data` is the server's JSON exactly as it arrived. An amount stays a string, and a field the
server left out stays out; the CLI never fills an absence with `[]`, `0` or `null`.

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "WRITES_DISABLED",
    "message": "Profile “prod” does not allow writes. …",
    "recoverable": false,
    "details": {}
  }
}
```

- `code` is the contract. Branch on it.
- `message` is for the person. It is the server's own refusal where the server worded one,
  otherwise the CLI's sentence, in Vietnamese by default or English with `--lang en`.
- `recoverable` says whether the same caller can fix it and try again without a person.
- `details` is present only when there is something structured to add. It carries the
  missing flags for `MISSING_REQUIRED_ARGUMENT`, the server's zod `issues` or the local
  `issues` for `VALIDATION_FAILED`, the `reason` oclif gave for `INVALID_ARGUMENT`, and the
  HTTP `status` for a sign-in refusal.

No envelope ever holds a cookie, a header, an environment value or a stack trace. With
`--verbose`, diagnostics go to stderr, never stdout.

## Codes and exit codes

| Exit | Code                        | Recoverable | Means                                                                          |
| ---- | --------------------------- | ----------- | ------------------------------------------------------------------------------ |
| 0    | none (`ok: true`)           |             | Done.                                                                          |
| 2    | `INVALID_ARGUMENT`          | yes         | A flag or its value was refused before anything ran.                           |
| 2    | `MISSING_REQUIRED_ARGUMENT` | yes         | `details.missing` names what to pass.                                          |
| 2    | `UNKNOWN_COMMAND`           | yes         | See `undercroft describe`.                                                     |
| 2    | `CONFIG_REQUIRED`           | yes         | No server chosen, a profile that does not exist, or an unreadable config file. |
| 2    | `CONFIRMATION_REQUIRED`     | yes         | A destructive command without `--yes`. Ask the person.                         |
| 3    | `NOT_FOUND`                 | no          | Not there, or not yours to see; deliberately the same answer.                  |
| 4    | `CONFLICT`                  | no          | The platform's state refused it; the message says which state.                 |
| 5    | `AUTHENTICATION_REQUIRED`   | no          | Not signed in to this origin, the session ended, or the code was rejected.     |
| 6    | `PERMISSION_DENIED`         | no          | Signed in, but your role does not allow it.                                    |
| 6    | `WRITES_DISABLED`           | no          | This profile does not allow writes, or a one-off `--url` was used.             |
| 6    | `HUMAN_REQUIRED`            | no          | Only a person at a terminal may do this.                                       |
| 7    | `NETWORK_ERROR`             | yes         | The server could not be reached, or did not answer as Undercroft.              |
| 7    | `TIMEOUT`                   | yes         | No answer within 120 seconds.                                                  |
| 8    | `VALIDATION_FAILED`         | yes         | The server refused the input, or `--dry-run` found a shape problem.            |
| 10   | `INTERNAL_ERROR`            | no          | The server failed. The detail stays on the server.                             |
| 130  | `CANCELLED`                 | no          | A person pressed Ctrl-C at a prompt. Never seen in agent mode.                 |

tRPC's codes map as follows:

- `UNAUTHORIZED` becomes `AUTHENTICATION_REQUIRED`.
- `FORBIDDEN` becomes `PERMISSION_DENIED`.
- `CONFLICT` and `PRECONDITION_FAILED` become `CONFLICT`. `PRECONDITION_FAILED` is how the
  platform says "the worker did not answer".
- `BAD_REQUEST` becomes `VALIDATION_FAILED`.
- Anything unrecognised becomes `INTERNAL_ERROR`.

## Effects

`undercroft describe --agent` gives every command an `effect`:

| Effect        | Needs                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| `read`        | A server and, for most commands, a session.                               |
| `write`       | A named profile with `allowWrites: true`, which only a person can set.    |
| `destructive` | That, and `--yes` in agent mode.                                          |
| `local`       | Nothing on the server's side: `auth`, `config` and `describe` themselves. |

`--dry-run` works on any command. It applies the `allowWrites` check, then stops before any
call and answers:

```json
{
  "ok": true,
  "data": {
    "dryRun": true,
    "operation": "runs.trigger",
    "input": { "tenantId": "CASE-0042", "source": "hubspot" }
  }
}
```

There is no idempotency key. The server offers none, so a retried write is a second write.

## Environments

- **URL.** `--url`, then `UNDERCROFT_URL`, then the chosen profile's URL.
- **Profile.** `--profile`, then `UNDERCROFT_PROFILE`, then the nearest `undercroft.cli.json`
  (`{ "profile": "local" }`) above the working directory, then `defaultProfile`.
- **Where the files live.** `$UNDERCROFT_CLI_HOME`, then `$XDG_CONFIG_HOME/undercroft`, then
  `~/.config/undercroft`: `config.json` and `credentials.json` (mode 0600).
- **Sessions.** A session is keyed by the origin that issued it and is never sent to another,
  so `http://localhost:3000` and `http://127.0.0.1:3000` are two origins.
