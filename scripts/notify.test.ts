/**
 * The notifier's promises that a reader of the Lark group cannot check for themselves: that
 * text from outside the repo cannot page the whole group, that GitHub's markdown arrives as
 * markdown Lark renders, and that a failed deploy says where it stopped. That a notice Lark
 * refused is not reported as posted is the wire module's, pinned in
 * `packages/core/src/lark.test.ts`.
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
    labels: [{ name: MENTION_ALL }],
  },
});

const RELEASE_BODY = [
  ":robot: I have created a release *beep* *boop*",
  "---",
  "",
  "",
  "## [1.24.0](https://github.example.test/o/r/compare/v1.23.0...v1.24.0) (2026-09-24)",
  "",
  "### Features",
  "",
  "* **people:** change a member's role ([#169](https://github.example.test/o/r/issues/169))",
].join("\n");

const PR_OPENED = JSON.stringify({
  action: "opened",
  sender: { login: "release-bot" },
  pull_request: {
    number: 170,
    title: "chore(main): release 1.24.0",
    body: RELEASE_BODY,
    html_url: "https://github.example.test/o/r/pull/170",
    user: { login: "release-bot" },
    merged: false,
    draft: false,
    additions: 12,
    deletions: 5,
    changed_files: 6,
    head: { ref: "release-please--branches--main" },
    base: { ref: "main" },
  },
});

/** The `content` of every element in the rendered card that Lark reads as markup. */
function markupContents(node: unknown): string[] {
  if (typeof node !== "object" || node === null) {
    return [];
  }
  const own =
    "content" in node &&
    typeof node.content === "string" &&
    !("tag" in node && node.tag === "plain_text")
      ? [node.content]
      : [];
  return [...own, ...Object.values(node).flatMap(markupContents)];
}

it("leaves no live Lark tag in an issue's markup, so a mention in its text pages nobody", () => {
  const markup = markupContents(larkMessage(eventNotice("issues", ISSUE_OPENED))).join("\n");

  expect(markup).not.toContain("<at");
});

it("puts the trace id a bug report quotes on its card, so the failure is one lookup away", () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const body = `### What happened?\n\nIt failed.\n\n### Trace ID\n\n${traceId}\n\n### Error output and logs\n\n_No response_`;
  const opened = JSON.stringify({
    action: "opened",
    sender: { login: "someone" },
    issue: { ...JSON.parse(ISSUE_OPENED).issue, body },
  });

  expect(eventNotice("issues", opened).facts).toContainEqual([
    "Trace",
    { text: traceId, emphasis: "bold" },
  ]);
});

it("renders a release PR's markdown as Lark markdown: emoji, headings, bullets and links", () => {
  const markup = markupContents(larkMessage(eventNotice("pull_request", PR_OPENED))).join("\n");

  expect(markup).toContain(
    [
      "🤖 I have created a release *beep* *boop*",
      " ---",
      "",
      "**[1.24.0](https://github.example.test/o/r/compare/v1.23.0...v1.24.0) (2026-09-24)**",
      "",
      "**Features**",
      "",
      "- **people:** change a member's role ([#169](https://github.example.test/o/r/issues/169))",
    ].join("\n"),
  );
});

it("colours a PR's additions green and its deletions red", () => {
  const markup = markupContents(larkMessage(eventNotice("pull_request", PR_OPENED))).join("\n");

  expect(markup).toContain("<font color='green'>+12</font> <font color='red'>−5</font> in 6 files");
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
