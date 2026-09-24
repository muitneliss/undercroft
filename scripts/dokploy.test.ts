/**
 * `verify` is the step that decides whether a release shipped, so the two ways it can lie
 * are what this pins: calling a healthy stack broken (a one-shot migration that exited 0 is
 * success, not a dead container) and calling a stale stack shipped (a container running last
 * release's digest, or a migration that never ran).
 *
 * `preflight` is the step before it, and it lies by passing a deploy that would run some
 * other compose file than this checkout's: a panel still holding a pasted copy (the copy that
 * drifted until three releases failed on the host), a panel that would roll out every push,
 * or a branch whose file moved past the release. Each gets a test that it fires, one that
 * everything right passes, and one pins what the comparison deliberately forgives.
 *
 * The fetcher below REFUSES a URL nobody recorded rather than answering a default. A fake
 * that always answers would make `verify` pass against requests it never should have sent --
 * which is exactly the bug in "compare `latest` to `latest`" that the release-tag argument
 * exists to close.
 */

import { expect, test as it } from "bun:test";

import {
  type Config,
  type Deps,
  oneShotServices,
  preflight,
  type Rollout,
  verify,
} from "./dokploy.ts";

const ENDPOINT = "https://panel.example.test/api";
const CFG: Config = { endpoint: ENDPOINT, apiKey: "test-key", composeId: "compose-1" };
const APP = "undercroft-test";

const WORKER_DIGEST = `sha256:${"1".repeat(64)}`;
const CONTROL_DIGEST = `sha256:${"2".repeat(64)}`;
const STALE_DIGEST = `sha256:${"9".repeat(64)}`;

const BRANCH_FILE_URL =
  "https://api.github.com/repos/muitneliss/undercroft/contents/deploy/compose/docker-compose.server.yml?ref=main";

/** Two released services: one meant to stay up, one meant to run and exit. */
const COMPOSE = [
  "services:",
  "  worker:",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: A compose file's own `${VAR:-default}`, quoted here as the fixture bytes. Reading it as a JS placeholder is the misreading.
  "    image: ghcr.io/muitneliss/undercroft-worker:${IMAGE_TAG:-latest}",
  "    depends_on:",
  "      db-migrate:",
  "        condition: service_completed_successfully",
  "  db-migrate:",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: As above: compose interpolation, not a JS template.
  "    image: ghcr.io/muitneliss/undercroft-control-plane:${IMAGE_TAG:-latest}",
  '    command: ["bun", "run", "migrate"]',
].join("\n");

/**
 * What a git-source panel still reports as its `composeFile`: the last paste, which is never
 * deployed. Its only service is one the checkout does not have, so a reader that trusted it
 * would ask for routes nobody recorded.
 */
const STALE_PASTE = ["services:", "  metabase:", "    image: metabase/metabase:latest"].join("\n");

/** The release being verified, against this checkout's file. */
const ROLLOUT: Rollout = { composeFile: COMPOSE, ghcrToken: "", releaseTag: "v1.3.0" };

/** A panel set up the way ADR 0049 says: clone main's file, never deploy on push. */
const PANEL = {
  composeId: "compose-1",
  name: "undercroft",
  appName: APP,
  composeFile: STALE_PASTE,
  command:
    "compose -p undercroft-test --env-file deploy/compose/.env -f deploy/compose/docker-compose.server.yml up -d --pull always --wait --wait-timeout 600 --remove-orphans",
  sourceType: "git",
  customGitUrl: "https://github.com/muitneliss/undercroft.git",
  customGitBranch: "main",
  composePath: "deploy/compose/docker-compose.server.yml",
  autoDeploy: false,
  composeStatus: "done",
};

interface Recorder {
  readonly deps: Deps;
  readonly lines: string[];
}

function recorder(recorded: Record<string, unknown>): Recorder {
  const lines: string[] = [];
  const deps: Deps = {
    fetch: (input: string) => {
      const body = recorded[input];
      if (body === undefined) {
        const known = Object.keys(recorded).join("\n  ");
        return Promise.reject(
          new Error(`no recorded response for ${input}\nrecorded:\n  ${known}`),
        );
      }
      // A file is served as its bytes, the way GitHub's raw media type serves it.
      const text = typeof body === "string" ? body : JSON.stringify(body);
      return Promise.resolve(new Response(text, { status: 200 }));
    },
    sleep: () => Promise.resolve(),
    log: (line: string) => lines.push(line),
    now: () => 0,
  };
  return { deps, lines };
}

function ghcr(repo: string, tag: string, digest: string): Record<string, unknown> {
  return {
    [`https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`]: {
      token: "ghcr-token",
    },
    [`https://ghcr.io/v2/${repo}/manifests/${tag}`]: { config: { digest } },
  };
}

interface Scenario {
  readonly tag?: string;
  readonly workerState?: string;
  readonly workerDigest?: string;
  readonly migrateState?: { Status: string; ExitCode: number } | "omitted";
  readonly migrateDigest?: string;
  readonly panel?: Readonly<Record<string, unknown>>;
  readonly onBranch?: string;
}

/** A stack where both services are healthy, minus whatever the scenario spoils. */
function routes(scenario: Scenario = {}): Record<string, unknown> {
  const tag = scenario.tag ?? "latest";
  const workerState = scenario.workerState ?? "running";
  const migrateState = scenario.migrateState ?? ({ Status: "exited", ExitCode: 0 } as const);

  return {
    [`${ENDPOINT}/compose.one?composeId=compose-1`]: { ...PANEL, ...scenario.panel },
    [BRANCH_FILE_URL]: scenario.onBranch ?? COMPOSE,
    [`${ENDPOINT}/docker.getContainersByAppNameMatch?appName=${APP}`]: [
      {
        containerId: "worker-container",
        name: `${APP}-worker-1`,
        state: workerState,
        status: workerState === "running" ? "Up 2 minutes" : "Exited (1) 2 minutes ago",
      },
      {
        containerId: "migrate-container",
        name: `${APP}-db-migrate-1`,
        state: "exited",
        status: "Exited (0) 6 seconds ago",
      },
    ],
    [`${ENDPOINT}/docker.getConfig?containerId=worker-container`]: {
      Image: scenario.workerDigest ?? WORKER_DIGEST,
      Config: { Image: `ghcr.io/muitneliss/undercroft-worker:${tag}` },
      State: { Status: "running", ExitCode: 0 },
    },
    [`${ENDPOINT}/docker.getConfig?containerId=migrate-container`]: {
      Image: scenario.migrateDigest ?? CONTROL_DIGEST,
      Config: { Image: `ghcr.io/muitneliss/undercroft-control-plane:${tag}` },
      ...(migrateState === "omitted" ? {} : { State: migrateState }),
    },
    ...ghcr("muitneliss/undercroft-worker", tag, WORKER_DIGEST),
    ...ghcr("muitneliss/undercroft-control-plane", tag, CONTROL_DIGEST),
  };
}

it("a one-shot service that exited 0 is a success, not a dead container", async () => {
  // Also the proof that the release tag, not the panel's moving pointer, is what ghcr is
  // asked for: the recorded routes answer only `v1.3.0`, so reaching for `latest` would be a
  // refusal that fails this test rather than a pass -- the whole point of the fetcher
  // refusing unmodelled requests.
  const { deps, lines } = recorder(routes({ tag: "v1.3.0" }));

  await verify(CFG, deps, ROLLOUT);

  expect(lines).toContain("verify ok");
});

it("a one-shot service that exited non-zero fails the release", async () => {
  const { deps } = recorder(
    routes({ tag: "v1.3.0", migrateState: { Status: "exited", ExitCode: 1 } }),
  );

  await expect(verify(CFG, deps, ROLLOUT)).rejects.toThrow(
    /db-migrate: one-shot service is exited with exit code 1/u,
  );
});

it("a one-shot service still running when verify asks fails the release", async () => {
  const { deps } = recorder(
    routes({ tag: "v1.3.0", migrateState: { Status: "running", ExitCode: 0 } }),
  );

  await expect(verify(CFG, deps, ROLLOUT)).rejects.toThrow(
    /db-migrate: one-shot service is running/u,
  );
});

it("a one-shot service whose inspect carries no State is refused, not assumed complete", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", migrateState: "omitted" }));

  await expect(verify(CFG, deps, ROLLOUT)).rejects.toThrow(
    /db-migrate: docker.getConfig returned no State/u,
  );
});

it("a one-shot service that exited 0 on the wrong image still fails", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", migrateDigest: STALE_DIGEST }));

  await expect(verify(CFG, deps, ROLLOUT)).rejects.toThrow(
    new RegExp(`db-migrate: running ${STALE_DIGEST}`, "u"),
  );
});

it("a long-running service that is not running still fails the release", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", workerState: "exited" }));

  await expect(verify(CFG, deps, ROLLOUT)).rejects.toThrow(/worker: container is exited/u);
});

it("a long-running service on a stale digest fails the release", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", workerDigest: STALE_DIGEST }));

  await expect(verify(CFG, deps, ROLLOUT)).rejects.toThrow(
    new RegExp(`worker: running ${STALE_DIGEST}`, "u"),
  );
});

it("preflight passes when the panel clones main's compose file and main carries this one", async () => {
  const { deps, lines } = recorder(routes());

  await preflight(CFG, deps, COMPOSE);

  expect(lines).toContain("preflight ok");
});

it("preflight refuses a panel that still holds a pasted copy of the compose file", async () => {
  const { deps } = recorder(routes({ panel: { sourceType: "raw", customGitUrl: null } }));

  await expect(preflight(CFG, deps, COMPOSE)).rejects.toThrow(/sourceType is "raw", not "git"/u);
});

it("preflight refuses a panel that would deploy every push to main", async () => {
  const { deps } = recorder(routes({ panel: { autoDeploy: true } }));

  await expect(preflight(CFG, deps, COMPOSE)).rejects.toThrow(/autoDeploy is true, not false/u);
});

it("preflight refuses when main's compose file moved past the one this release carries", async () => {
  // A change merged while the release's images built: the host would clone it and run it
  // beside images that predate it.
  const onBranch = `${COMPOSE}\n  kestra-flows:\n    image: ghcr.io/muitneliss/undercroft-control-plane:latest`;
  const { deps } = recorder(routes({ onBranch }));

  await expect(preflight(CFG, deps, COMPOSE)).rejects.toThrow(
    /deploy\/compose\/docker-compose\.server\.yml on main is not the one this checkout carries \(first difference at line 10/u,
  );
});

it("preflight forgives line endings and trailing blank lines, which YAML does not read", async () => {
  const checkedOut = `${COMPOSE.replaceAll("\n", "\r\n")}\n\n`;
  const { deps, lines } = recorder(routes());

  await preflight(CFG, deps, checkedOut);

  expect(lines).toContain("preflight ok");
});

it("oneShotServices names what the compose file declares runs to completion", () => {
  expect([...oneShotServices(COMPOSE)]).toEqual(["db-migrate"]);
});

it("oneShotServices names nothing when no service is declared to complete", () => {
  const noJobs = [
    "services:",
    "  worker:",
    "    image: ghcr.io/muitneliss/undercroft-worker:latest",
    "    depends_on:",
    "      postgres:",
    "        condition: service_healthy",
  ].join("\n");

  expect([...oneShotServices(noJobs)]).toEqual([]);
});
