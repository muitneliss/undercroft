/**
 * Post what happened in this repository to the team's Lark group, as a card.
 *
 *   bun run scripts/notify.ts deploy | release | event | test
 *
 *   deploy   deploy.yml's outcome, and the step that stopped it when it failed
 *   release  a release that failed before its deploy could start (versioning, images, CLI)
 *   event    the GitHub event this run was triggered by: an issue, a pull request, or a
 *            failed `ci` run on main -- see `githubEvents.ts`
 *   test     a card that says nothing happened, to prove the wiring after a rotation
 *
 * Each notice reads the environment its workflow job sets; `lark.ts` owns the wire format and
 * the webhook credential. A notice that cannot be posted exits non-zero -- the notify job goes
 * red rather than the group silently hearing nothing.
 */

import { readFileSync } from "node:fs";
import process from "node:process";

import { eventNotice, shortSha } from "./githubEvents.ts";
import { larkConfigFromEnv, larkMessage, type Notice, send, type Tone } from "./lark.ts";

const RELEASE_TAG = /^v\d/u;

type Env = Readonly<Record<string, string | undefined>>;

interface GitHubRun {
  readonly repository: string;
  readonly server: string;
  readonly runUrl: string;
  readonly actor: string;
  readonly sha: string;
}

function githubRun(env: Env): GitHubRun {
  const server = env.GITHUB_SERVER_URL ?? "https://github.com";
  const repository = env.GITHUB_REPOSITORY ?? "unknown repository";
  return {
    repository,
    server,
    runUrl: `${server}/${repository}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`,
    actor: env.GITHUB_TRIGGERING_ACTOR ?? env.GITHUB_ACTOR ?? "unknown",
    sha: shortSha(env.GITHUB_SHA ?? "unknown"),
  };
}

/** deploy.yml's steps by id, in the order they run, with the words a reader knows them by. */
const DEPLOY_STEPS: readonly (readonly [id: string, label: string])[] = [
  ["secrets", "required secrets"],
  ["preflight", "preflight (panel config)"],
  ["deploy", "deploy (Dokploy rollout)"],
  ["verify", "verify (running image digests)"],
  ["smoke", "smoke test (public health)"],
];

type Outcomes = Readonly<Record<string, { readonly outcome?: string } | undefined>>;

/**
 * The step that stopped the deploy, named only when the steps context says so. A failure in
 * an unnamed step (checkout, install) is reported as that, not pinned on a neighbour.
 */
function failedStep(stepsJson: string): string {
  let steps: Outcomes = {};
  try {
    steps = JSON.parse(stepsJson);
  } catch {
    return "unknown -- the job did not report its steps";
  }
  const failed = DEPLOY_STEPS.find(([id]) => steps[id]?.outcome === "failure");
  return failed === undefined ? "a setup step (checkout or install)" : failed[1];
}

export function deployNotice(env: Env): Notice {
  const run = githubRun(env);
  const tag = env.DEPLOY_TAG ?? "unknown";
  const result = env.DEPLOY_RESULT ?? "unknown";
  const site = env.DEPLOY_SITE ?? "";
  const headings: Record<string, readonly [string, Tone]> = {
    success: [`Deployed ${tag}`, "green"],
    failure: [`Deploy of ${tag} failed`, "red"],
    cancelled: [`Deploy of ${tag} was cancelled`, "grey"],
  };
  const [title, tone] = headings[result] ?? [`Deploy of ${tag} ended as ${result}`, "orange"];
  const facts: [string, string][] = [
    ["Release", tag],
    ["Result", result],
  ];
  if (result === "failure") {
    facts.push(["Stopped at", failedStep(env.DEPLOY_STEPS ?? "")]);
  }
  facts.push(
    ["Trigger", env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "by hand" : "release"],
    ["By", run.actor],
    ["Commit", run.sha],
  );
  const links: [string, string][] = [["Deploy run", run.runUrl]];
  if (RELEASE_TAG.test(tag)) {
    links.push(["Release notes", `${run.server}/${run.repository}/releases/tag/${tag}`]);
  }
  if (site !== "") {
    links.push(["Open site", site]);
  }
  return { title, tone, facts, body: "", links };
}

/** release.yml's jobs that run before the deploy, with the words a reader knows them by. */
const RELEASE_JOBS: readonly (readonly [id: string, label: string])[] = [
  ["release-please", "versioning (release-please)"],
  ["release-images", "image build"],
  ["release-cli", "CLI upload"],
];

type Results = Readonly<Record<string, { readonly result?: string } | undefined>>;

export function releaseNotice(env: Env): Notice {
  const run = githubRun(env);
  const tag = env.RELEASE_TAG ?? "";
  let needs: Results = {};
  try {
    needs = JSON.parse(env.RELEASE_NEEDS ?? "");
  } catch {
    // Left empty: every job then reads as unreported below, never as passed.
  }
  const failed = RELEASE_JOBS.filter(([id]) => needs[id]?.result === "failure").map(
    ([, label]) => label,
  );
  // The deploy starts only after the version and the images; either failing means nothing shipped.
  const deployed =
    needs["release-please"]?.result === "success" && needs["release-images"]?.result === "success";
  return {
    title: tag === "" ? "Release failed" : `Release ${tag} failed`,
    tone: "red",
    facts: [
      ["Failed", failed.length > 0 ? failed.join(", ") : "unknown -- see the run"],
      ["Deploy", deployed ? "went ahead -- see its own notice" : "not started, nothing shipped"],
      ["By", run.actor],
      ["Commit", run.sha],
    ],
    body: "",
    links: [["Release run", run.runUrl]],
  };
}

function testNotice(env: Env): Notice {
  const run = githubRun(env);
  return {
    title: "Undercroft notifications are wired up",
    tone: "blue",
    facts: [
      ["Repository", run.repository],
      ["By", run.actor],
    ],
    body: "A test card. Deploys, failed releases, issues, pull requests and CI failures on main post here.",
    links: [],
  };
}

function noticeFor(command: string, env: Env): Notice {
  switch (command) {
    case "deploy":
      return deployNotice(env);
    case "release":
      return releaseNotice(env);
    case "event":
      return eventNotice(
        env.GITHUB_EVENT_NAME ?? "",
        readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"),
      );
    case "test":
      return testNotice(env);
    default:
      throw new Error("usage: notify.ts deploy|release|event|test");
  }
}

async function main(): Promise<void> {
  const notice = noticeFor(process.argv[2] ?? "", process.env);
  await send(larkConfigFromEnv(process.env), larkMessage(notice), {
    fetch: (input, init): Promise<Response> => globalThis.fetch(input, init ?? {}),
    now: () => Date.now(),
  });
  process.stdout.write(`posted: ${notice.title}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
