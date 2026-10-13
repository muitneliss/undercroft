# 122. What a model reads over MCP is bounded in every copy

- Status: Accepted
- Date: 2026-10-13
- Supersedes: from [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md), the clause of its
  "A result" decision that makes `structuredContent` "the whole answer"; and from
  [ADR 0111](0111-an-export-is-a-link-to-a-streamed-csv.md), the statement in its context that a
  result is "stored whole in `structuredContent`"
- Keeps: everything else in both. The clip itself -- 50 items per top-level list, 60 KB, every
  cut named in a worded note, never silent -- is 0060's and stands; this ADR applies it to the
  second copy. 0111's export remains the way to the rows themselves.

## Context

ADR 0060 answered a tool call with two copies of the result: a JSON text for the model, clipped
to 50 items per top-level list and 60 KB, and `structuredContent`, the whole answer, never
clipped. The clip rested on "a model's context is not a data channel", and on the assumption
that the model reads the text.

Claude Code reads `structuredContent`. An audit of 2,433 calls in 119 Claude Code sessions
(issue #438) found 76 results that overflowed the client's own limit and were spilled to disk
whole -- up to 315 KB for a Google Drive scope, 292 KB for a transform run's detail -- and an
agent that went on to filter the spilled file with `jq` or `python3` 1,117 times. A `runs_list`
asked for 100 got 100, where the text would have shown 50. The bound held for the text and for
no client that preferred the other copy.

The MCP Apps widgets (ADR 0061) need the opposite: the grid draws up to 500 rows, and the run
widget lists a run's newest events from a feed of up to 300, oldest first -- a clip at 50 would
drop exactly the ones it shows.

## Decision

1. **`structuredContent` is clipped the way the text is.** At most 50 items of any top-level
   list, and the worded notes for each cut carried inside it, in the field
   `"undercroft/clipped"` (`CLIPPED_NOTES_FIELD` in `mcpAnswers.ts`): an array of the same
   sentences the text carries as extra blocks, absent when nothing was cut. The `/` keeps it
   from ever being a procedure's own field.
2. **An answer still over 60 KB after that has no `structuredContent`.** Its text is cut at
   60 KB and says so, and says there is no structured copy. The specification requires
   `structuredContent` only of a tool that declares an `outputSchema`, and none does
   (`listTools` in `mcpTools.ts`).
3. **The notes say where the rest is: not in this answer.** The model is told to call again with
   a narrower scope -- a filter, a limit, a cursor, where the tool takes one. Procedures that
   answer an unbounded list without one are the companion issues' to fix, in the procedure,
   which is where a bound belongs; this door only stops handing an unbounded copy to whichever
   client prefers it.
4. **A widget gets the whole answer in the result's `_meta`**, under `"undercroft/answer"`
   (`WIDGET_ANSWER_META` in `mcpWidgets.ts`), beside the `"undercroft/call"` it already
   carried. MCP Apps delivers a result's `_meta` to the widget and calls it "not intended for
   model context". It is written
   for a path a widget draws (`MCP_WIDGETS`) and for a path a widget asks for itself through the
   host (`WIDGET_READS`: `runs.get`, `runs.events`), and only when that widget was built. A
   widget may call a tool only by a path in `WIDGET_READS` (`toolFor` in `host.ts`), so a new poll
   cannot silently read the clipped copy.
5. **A widget falls back to the clipped copy, and says so.** A host that relays a result without
   its `_meta` leaves the widget `structuredContent`; the widget then draws it with the door's own
   notes beside it, and an answer with neither copy is drawn as a sentence saying there is
   nothing to draw, never as an empty grid.

A refusal is small and keeps its whole `structuredContent`, as before.

## How `_meta` reaching the widget was verified

Against `@modelcontextprotocol/ext-apps` 2.0.0 and `@modelcontextprotocol/core` 2.1.0, the
versions `bun.lock` pins, and the MCP Apps specification (`specification/2026-01-26/apps.mdx` in
`modelcontextprotocol/ext-apps`):

- the specification's `ui/notifications/tool-result` carries `params: CallToolResult`, and its
  worked example passes the server's `_meta` to the view unchanged; its best practices list
  `_meta` as "not intended for model context";
- the package's `McpUiToolResultNotification["params"]` is `CallToolResult`, and the reference
  `AppBridge` sends it as given (`sendToolResult`);
- a view's `tools/call` (`App.callServerTool`) is forwarded by the reference `AppBridge` to the
  server with `client.request` and its result returned as the server answered it; the core
  `ResultSchema` is a loose object whose `_meta` is a loose object, so no key is dropped in
  parsing.

What was not verified is what Claude Code itself does with a result's `_meta`; nothing in this
change depends on it reading it, and the specification says a host should not put it in the
model's context.

## Options rejected

- **Omit `structuredContent` for every tool no widget draws.** The issue's second sketch. It
  leaves the widget-drawn tools -- the query results, the largest answers there are -- unbounded
  for a client that reads `structuredContent`, which is the defect.
- **Keep `structuredContent` whole and rely on clients reading the text.** The audit is what
  the most common client does.
- **A widget-only tool (`visibility: ["app"]`) the widget calls for the whole answer.** A second
  round trip per draw, a second procedure surface to keep in step with the router, and a tool a
  model-context client might still list and call. `_meta` is the lane MCP Apps defines for
  exactly this.
- **Clip `structuredContent` to the 60 KB bound by cutting its JSON.** A cut JSON is not an
  object, and `structuredContent` must be one; a copy that cannot be parsed helps nobody.

## Consequences

- The bound holds whichever copy a client reads: at most 60 KB of JSON, 50 items per list.
- A client that read the whole answer from `structuredContent` now gets 50 items and a note,
  and must page or narrow. That is the intended change in behaviour.
- A widget-drawn result can be large on the wire, as before; it is the host's to pass to the
  widget, not the model's to read.
