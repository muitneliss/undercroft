/**
 * What a widget draws from (`answerOf`). The door clips what a model may read and carries the
 * whole answer in `_meta` for the widget (ADR 0122); a widget that read the clipped copy as all
 * there is would show a person the first 50 rows of 300 and say nothing. The results here are
 * shaped as the door writes them; `mcp.test.ts` pins that it does.
 */

import { describe, expect, test as it } from "bun:test";
import { answerOf } from "./host.ts";

const NOTE = "This answer holds 50 of the 60 items in items.";
const clippedCopy = { items: [1, 2], "undercroft/clipped": [NOTE] };

describe("the answer a widget draws", () => {
  it("is the whole one in _meta when the host passes it, not the model's clipped copy", () => {
    const answer = answerOf({
      content: [],
      structuredContent: clippedCopy,
      _meta: { "undercroft/answer": { items: [1, 2, 3] } },
    });

    expect(answer).toEqual({ content: { items: [1, 2, 3] }, clipped: [] });
  });

  it("falls back to the clipped copy with the door's notes, or to nothing when there is none", () => {
    expect([
      answerOf({ content: [], structuredContent: clippedCopy }),
      answerOf({ content: [{ type: "text", text: "{}" }] }),
    ]).toEqual([
      { content: clippedCopy, clipped: [NOTE] },
      { content: null, clipped: [] },
    ]);
  });
});
