/**
 * The notifier's promises that a reader of the Lark group cannot check for themselves: that
 * text from outside the repo cannot page the whole group, and that a failed deploy says where
 * it stopped. That a notice Lark refused is not reported as posted is the wire module's, and
 * is pinned beside it in `packages/core/src/lark.test.ts`.
 */

import { expect, test as it } from "bun:test";

import { eventNotice } from "./githubEvents.ts";
import { larkMessage } from "../packages/core/src/lark.ts";
import { deployNotice } from "./notify.ts";

const MENTION_ALL = "<at id=all></at> urgent";

const ISSUE_OPENED = JSON.stringify({
  action: "opened",
  sender: { login: "someone" },
  issue: {
    number: 7,
    title: MENTION_ALL,
    body: `body ${MENTION_ALL}`,
    html_url: "https://github.example.test/o/r/issues/7",
    user: { login: "someone" },
    labels: [],
  },
});

/** The `tag` of every text element in the rendered card whose `content` holds `needle`. */
function tagsOfTextsContaining(node: unknown, needle: string): unknown[] {
  if (typeof node !== "object" || node === null) {
    return [];
  }
  const own =
    "content" in node && typeof node.content === "string" && node.content.includes(needle)
      ? ["tag" in node ? node.tag : undefined]
      : [];
  return [...own, ...Object.values(node).flatMap((child) => tagsOfTextsContaining(child, needle))];
}

it("renders an issue's title and body as plain text, so a Lark mention in them pages nobody", () => {
  const tags = tagsOfTextsContaining(larkMessage(eventNotice("issues", ISSUE_OPENED)), MENTION_ALL);

  expect(tags).toEqual(["plain_text", "plain_text"]);
});

it("names the step that stopped a failed deploy", () => {
  const notice = deployNotice({
    DEPLOY_TAG: "v1.2.3",
    DEPLOY_RESULT: "failure",
    DEPLOY_STEPS: JSON.stringify({
      secrets: { outcome: "success" },
      preflight: { outcome: "success" },
      deploy: { outcome: "success" },
      verify: { outcome: "failure" },
      smoke: { outcome: "skipped" },
    }),
  });

  expect(notice.facts).toContainEqual(["Stopped at", "verify (running image digests)"]);
});
