/**
 * The notifier's promises that a reader of the Lark group cannot check for themselves: that
 * text from outside the repo cannot page the whole group, that GitHub's markdown arrives as
 * markdown Lark renders, that a notice Lark refused is not reported as posted, and that a
 * failed deploy says where it stopped.
 */

import { expect, test as it } from "bun:test";

import { eventNotice } from "./githubEvents.ts";
import { type Fetch, larkMessage, send } from "./lark.ts";
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

const CFG = { url: "https://lark.example.test/hook/abc", secret: "" };
const MESSAGE = larkMessage({ title: "t", tone: "blue", facts: [], body: "", links: [] });

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

function larkAnswering(status: number, body: unknown): Fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function now(): number {
  return 1_700_000_000_000;
}

it("leaves no live Lark tag in an issue's markup, so a mention in its text pages nobody", () => {
  const markup = markupContents(larkMessage(eventNotice("issues", ISSUE_OPENED))).join("\n");

  expect(markup).not.toContain("<at");
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

it("fails the send when Lark answers HTTP 200 with a non-zero code", async () => {
  const refusing = larkAnswering(200, { code: 19_021, msg: "sign match fail" });

  await expect(send(CFG, MESSAGE, { fetch: refusing, now })).rejects.toThrow("19021");
});

it("completes the send when Lark answers code 0", async () => {
  const accepting = larkAnswering(200, { code: 0, msg: "success", data: {} });

  await expect(send(CFG, MESSAGE, { fetch: accepting, now })).resolves.toBeUndefined();
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
