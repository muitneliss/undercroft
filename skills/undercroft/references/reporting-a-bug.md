# Reporting a problem in Undercroft

When Undercroft itself fails, file a bug so a maintainer can fix it. Do not only work around
it. The report goes through the repository's bug form, so it reaches triage in the shape the
maintainers asked for.

## What to report

- `INTERNAL_ERROR`, which means the server failed.
- `NETWORK_ERROR` or `TIMEOUT` that is still there after your one retry, once the person
  confirms the server is up.
- `VALIDATION_FAILED` on input that matches the schema the door gave you (the MCP tool's
  input schema, or `undercroft describe <command>`). That means the door and the server
  disagree.
- An answer that breaks the contract in `references/cli.md` or `references/mcp.md`: stdout
  that is not exactly one JSON envelope, an exit code that does not match `error.code`, a
  code missing from the table, a refusal without `isError`.
- A value you do not believe. For example, a run that says `succeeded` with no records
  behind it, or two reads that contradict each other. A wrong value that looks right is the
  worst kind of bug.

Do not report a refusal. Codes such as `AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`,
`WRITES_DISABLED`, `HUMAN_REQUIRED`, `NOT_FOUND`, `CONFIRMATION_REQUIRED` and
`CONFIG_REQUIRED` mean the platform is working as designed. Do not report your own mistakes
either, such as a misspelled flag or a tool you called with the wrong input.

**A security problem never goes in a public issue.** Examples are seeing another tenant's
data, a write that got past a read-only grant or `allowWrites`, or a secret in an answer.
Stop, and give the person
`https://github.com/muitneliss/undercroft/security/advisories/new`.

## How to file

1. **Search first:**
   `gh issue list --repo muitneliss/undercroft --state all --search "<code or key words>"`.
   If the bug is already filed, give the person its link instead of filing it again.
2. **Read the form; do not work from memory.** Fetch it with
   `curl -fsSL https://raw.githubusercontent.com/muitneliss/undercroft/main/.github/ISSUE_TEMPLATE/bug_report.yml`.
   Fill every `required` field. For the questions that offer choices, use one of the listed
   options word for word. For "Where did you see it?", that is
   `CLI in agent mode (Claude Code, Codex or another agent)` when you used the CLI, and
   `MCP (claude.ai, Claude Desktop, Claude Code or another client)` when you used the MCP
   tools.
3. **Collect the facts; do not guess them.** You need the exact command or tool call you
   made, the whole failure envelope or refusal, and the operating system. With the CLI, add
   `undercroft --version`, `node --version` and the server's host from
   `undercroft config show --agent`; over MCP, add the server's URL and your host's name. The
   refusal's `traceId`, when present, goes in the form's **Trace ID** field as well as in the
   envelope: it is what the operator looks the failure up by. For the server's version and
   the person's role, ask the person. If a fact is not known, write "unknown".
4. **Redact.** The repository is public. Replace real tenant IDs, e-mail addresses, names
   and record contents with `CASE-0042` and `acme@example.test`. Never include a sign-in
   code, a cookie, a token or anything from `credentials.json`. An envelope never holds a
   secret, but its `message` can quote real data.
5. **Show the person the redacted draft and file it only after they agree.** Filing
   publishes it. Then run:
   `gh issue create --repo muitneliss/undercroft --title "bug: <one line>" --label bug --body-file -`.
   Write the body as the form would render it. That is one `### <field label>` heading per
   field, in the form's order, with `_No response_` under an optional field you leave
   empty. Put the envelope in a fenced block.
6. **If `gh` is missing or not signed in,** give the person a link to the form with the
   title and the text fields filled in, and let them submit it:
   `https://github.com/muitneliss/undercroft/issues/new?template=bug_report.yml&title=<title>&what-happened=<text>&expected=<text>&steps=<text>&trace-id=<traceId>&logs=<envelope>`.
   URL-encode each value.

Then tell the person the issue's URL. If a workaround exists, carry on with the task. If
not, stop there.
