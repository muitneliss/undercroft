---
title: ADR 0122 What a Model Reads over MCP Is Bounded in Every Copy
type: source
date: 2026-10-13
tags: []
source: docs/adr/0122-what-a-model-reads-over-mcp-is-bounded-in-every-copy.md
source_path: docs/adr/0122-what-a-model-reads-over-mcp-is-bounded-in-every-copy.md
source_hash: cdac87ada5ae499ea95dd2a4da2c27fc7bbc2b4de5156f74f81136395a09b230
ingested: 2026-10-13
---

# ADR 0122 What a Model Reads over MCP Is Bounded in Every Copy

Supersedes, from [[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]], the clause that makes `structuredContent` the whole answer, and from [[ADR 0111 An Export Is a Link to a Streamed CSV]] the statement that a result is stored whole there. The clip itself (50 items per top-level list, 60 KB, every cut named in a worded note) is 0060's and stands. Issue #438: Claude Code puts `structuredContent`, not the clipped text, in the model's context, so an audit of 2,433 calls found 76 results spilled to disk whole (up to 315 KB) and an agent filtering them with `jq`/`python3` 1,117 times.

Decision. `structuredContent` gets the same list clip as the text, carrying the same notes in the field `"undercroft/clipped"` (`CLIPPED_NOTES_FIELD` in `mcpAnswers.ts`), absent when nothing was cut. An answer still over 60 KB after the clip has no `structuredContent` (no tool declares an `outputSchema`, so the spec does not require it); its text is cut at 60 KB and says so. The notes tell the model the rest is not in the answer and to call again narrower (a filter, a limit, a cursor). A widget ([[ADR 0061: An MCP client signs its person in, and draws two widgets]]) gets the whole answer in the result's `_meta` under `"undercroft/answer"` (`WIDGET_ANSWER_META` in `mcpWidgets.ts`), for a path a widget draws (`MCP_WIDGETS`) or asks for itself through the host (`WIDGET_READS`: `runs.get`, `runs.events`), when that widget was built; a widget calls tools only by a path in `WIDGET_READS` (`toolFor`). A widget given no `_meta` falls back to the clipped copy and shows the door's notes, and says there is nothing to draw when it has neither. Refusals keep their small whole `structuredContent`.

Verified against `@modelcontextprotocol/ext-apps` 2.0.0, `@modelcontextprotocol/core` 2.1.0 and the MCP Apps specification (2026-01-26): `ui/notifications/tool-result` carries a `CallToolResult` with the server's `_meta` ("not intended for model context"); the reference `AppBridge` forwards a view's `tools/call` to the server and returns its result as answered; core's result schema keeps every `_meta` key. Not verified: what Claude Code does with `_meta`.

Rejected: omitting `structuredContent` only for tools no widget draws (leaves the largest, widget-drawn answers unbounded); relying on clients to read the text; an app-only tool for the whole answer (a second round trip and surface); cutting `structuredContent`'s JSON at 60 KB (not an object). Consequence: a client that read whole answers from `structuredContent` now gets 50 items and a note, and must page or narrow.
