/**
 * What a card says about a GitHub event: an issue, a pull request, or a failed `ci` run.
 *
 * The payload arrives as the JSON file GitHub writes for the run (`GITHUB_EVENT_PATH`), and
 * these notices quote from it -- titles, bodies, branch names -- text written by anyone who
 * can open an issue. It is safe to quote because `packages/core/src/lark.ts` renders every string as plain text.
 */

import type { LarkNotice as Notice, LarkTone as Tone } from "../packages/core/src/lark.ts";

/** How much of an issue or PR body a card carries; the rest is one click away. */
const EXCERPT_CHARS = 400;
const SHORT_SHA_CHARS = 7;

export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_CHARS);
}

function excerpt(text: string | null | undefined): string {
  const trimmed = (text ?? "").trim();
  return trimmed.length > EXCERPT_CHARS ? `${trimmed.slice(0, EXCERPT_CHARS)}…` : trimmed;
}

interface User {
  readonly login: string;
}

interface IssuesPayload {
  readonly action: string;
  readonly sender: User;
  readonly issue: {
    readonly number: number;
    readonly title: string;
    readonly body: string | null;
    readonly html_url: string;
    readonly user: User;
    readonly state_reason?: string | null;
    readonly labels: readonly { readonly name: string }[];
  };
}

interface PullRequestPayload {
  readonly action: string;
  readonly sender: User;
  readonly pull_request: {
    readonly number: number;
    readonly title: string;
    readonly body: string | null;
    readonly html_url: string;
    readonly user: User;
    readonly merged: boolean;
    readonly draft: boolean;
    readonly additions: number;
    readonly deletions: number;
    readonly changed_files: number;
    readonly head: { readonly ref: string };
    readonly base: { readonly ref: string };
  };
}

interface WorkflowRunPayload {
  readonly workflow_run: {
    readonly name: string;
    readonly conclusion: string | null;
    readonly html_url: string;
    readonly head_branch: string;
    readonly head_sha: string;
    readonly run_attempt: number;
    readonly actor: User;
    readonly head_commit: { readonly message: string } | null;
  };
}

function issueNotice(json: string): Notice {
  const payload: IssuesPayload = JSON.parse(json);
  const { issue } = payload;
  const notPlanned = payload.action === "closed" && issue.state_reason === "not_planned";
  const tones: Record<string, Tone> = { opened: "blue", reopened: "orange", closed: "green" };
  const labels = issue.labels.map((label) => label.name).join(", ");
  return {
    title: `Issue #${issue.number} ${notPlanned ? "closed as not planned" : payload.action}: ${issue.title}`,
    tone: notPlanned ? "grey" : (tones[payload.action] ?? "grey"),
    facts: [
      ["By", payload.sender.login],
      ["Author", issue.user.login],
      ["Labels", labels === "" ? "none" : labels],
    ],
    body: payload.action === "opened" ? excerpt(issue.body) : "",
    links: [["Open issue", issue.html_url]],
  };
}

function pullRequestNotice(json: string): Notice {
  const payload: PullRequestPayload = JSON.parse(json);
  const pr = payload.pull_request;
  const action = payload.action === "closed" && pr.merged ? "merged" : payload.action;
  const tones: Record<string, Tone> = { opened: "blue", reopened: "orange", merged: "green" };
  const facts: [string, string][] = [
    ["By", payload.sender.login],
    ["Author", pr.user.login],
    ["Branch", `${pr.head.ref} → ${pr.base.ref}`],
    ["Changes", `+${pr.additions} −${pr.deletions} in ${pr.changed_files} files`],
  ];
  if (pr.draft) {
    facts.push(["Draft", "yes"]);
  }
  return {
    title: `PR #${pr.number} ${action}: ${pr.title}`,
    tone: tones[action] ?? "grey",
    facts,
    body: payload.action === "opened" ? excerpt(pr.body) : "",
    links: [["Open PR", pr.html_url]],
  };
}

function workflowRunNotice(json: string): Notice {
  const payload: WorkflowRunPayload = JSON.parse(json);
  const wf = payload.workflow_run;
  return {
    title: `${wf.name} ${wf.conclusion ?? "ended"} on ${wf.head_branch}`,
    tone: wf.conclusion === "failure" ? "red" : "orange",
    facts: [
      ["Workflow", wf.name],
      ["Commit", shortSha(wf.head_sha)],
      ["By", wf.actor.login],
      ["Attempt", String(wf.run_attempt)],
    ],
    body: excerpt(wf.head_commit?.message.split("\n")[0]),
    links: [["Open run", wf.html_url]],
  };
}

/**
 * `eventName` is GitHub's (`GITHUB_EVENT_NAME`); `pull_request_target` is how a fork's PR
 * reaches the secret. An event with no notice defined throws rather than posting a blank card.
 */
export function eventNotice(eventName: string, payloadJson: string): Notice {
  switch (eventName) {
    case "issues":
      return issueNotice(payloadJson);
    case "pull_request":
    case "pull_request_target":
      return pullRequestNotice(payloadJson);
    case "workflow_run":
      return workflowRunNotice(payloadJson);
    default:
      throw new Error(`no notice is defined for the ${eventName} event`);
  }
}
