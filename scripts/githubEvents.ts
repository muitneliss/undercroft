/**
 * What a card says about a GitHub event: an issue, a pull request, or a failed `ci` run.
 *
 * The payload arrives as the JSON file GitHub writes for the run (`GITHUB_EVENT_PATH`), and
 * these notices quote from it -- titles, bodies, branch names -- text written by anyone who
 * can open an issue. It is safe to quote because `packages/core/src/lark.ts` never lets it reach Lark as markup:
 * a body's markdown is rendered, a Lark tag inside it never is.
 */

import {
  bold,
  green,
  grey,
  type LarkNotice as Notice,
  type LarkTone as Tone,
  red,
  type Span,
} from "../packages/core/src/lark.ts";

const SHORT_SHA_CHARS = 7;

export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_CHARS);
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

/** A W3C trace id: what the issue forms' "Trace ID" field asks for. */
const TRACE_ID = /\b[0-9a-f]{32}\b/gu;
const TRACE_SECTION = /^### Trace ID\s*$(?<section>[\s\S]*?)(?=^### |(?![\s\S]))/mu;

/**
 * The trace ids an issue form's "Trace ID" field holds, so the card leads straight to the
 * server's record of the failure (ADR 0058). Only well-formed ids, from that section alone:
 * a form left empty renders `_No response_`, and an id quoted elsewhere is not a claim.
 */
function traceIdsOf(body: string | null): string[] {
  const section = TRACE_SECTION.exec(body ?? "")?.groups?.section ?? "";
  return [...new Set(section.match(TRACE_ID) ?? [])];
}

function issueNotice(json: string): Notice {
  const payload: IssuesPayload = JSON.parse(json);
  const { issue } = payload;
  const notPlanned = payload.action === "closed" && issue.state_reason === "not_planned";
  const tones: Record<string, Tone> = { opened: "blue", reopened: "orange", closed: "green" };
  const icons: Record<string, string> = { opened: "📌", reopened: "🔁", closed: "✅" };
  const labels = issue.labels.map((label) => label.name).join(", ");
  const traces = traceIdsOf(issue.body);
  return {
    title: `${notPlanned ? "🚫" : (icons[payload.action] ?? "📋")} Issue #${issue.number} ${notPlanned ? "closed as not planned" : payload.action}: ${issue.title}`,
    tone: notPlanned ? "grey" : (tones[payload.action] ?? "grey"),
    facts: [
      ["By", bold(payload.sender.login)],
      ["Author", bold(issue.user.login)],
      ["Labels", labels === "" ? grey("none") : labels],
      ...(traces.length === 0 ? [] : [["Trace", bold(traces.join(", "))] as const]),
    ],
    body: payload.action === "opened" ? (issue.body ?? "") : "",
    links: [["Open issue", issue.html_url]],
  };
}

function pullRequestNotice(json: string): Notice {
  const payload: PullRequestPayload = JSON.parse(json);
  const pr = payload.pull_request;
  const action = payload.action === "closed" && pr.merged ? "merged" : payload.action;
  const tones: Record<string, Tone> = { opened: "blue", reopened: "orange", merged: "green" };
  const icons: Record<string, string> = {
    opened: "🔀",
    reopened: "🔁",
    merged: "🎉",
    closed: "⛔",
  };
  const facts: [string, Span | readonly Span[]][] = [
    ["By", bold(payload.sender.login)],
    ["Author", bold(pr.user.login)],
    ["Branch", [bold(pr.head.ref), " → ", bold(pr.base.ref)]],
    [
      "Changes",
      [green(`+${pr.additions}`), " ", red(`−${pr.deletions}`), ` in ${pr.changed_files} files`],
    ],
  ];
  if (pr.draft) {
    facts.push(["Draft", grey("yes")]);
  }
  return {
    title: `${icons[action] ?? "🔀"} PR #${pr.number} ${action}: ${pr.title}`,
    tone: tones[action] ?? "grey",
    facts,
    body: payload.action === "opened" ? (pr.body ?? "") : "",
    links: [["Open PR", pr.html_url]],
  };
}

function workflowRunNotice(json: string): Notice {
  const payload: WorkflowRunPayload = JSON.parse(json);
  const wf = payload.workflow_run;
  return {
    title: `${wf.conclusion === "failure" ? "🔴" : "🟠"} ${wf.name} ${wf.conclusion ?? "ended"} on ${wf.head_branch}`,
    tone: wf.conclusion === "failure" ? "red" : "orange",
    facts: [
      ["Workflow", bold(wf.name)],
      ["Result", wf.conclusion === "failure" ? red("failure") : (wf.conclusion ?? "unknown")],
      ["Commit", shortSha(wf.head_sha)],
      ["By", bold(wf.actor.login)],
      ["Attempt", String(wf.run_attempt)],
    ],
    body: wf.head_commit?.message.split("\n")[0] ?? "",
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
