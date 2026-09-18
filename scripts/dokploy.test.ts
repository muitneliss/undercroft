/**
 * `verify` is the step that decides whether a release shipped, so the two ways it can lie
 * are what this pins: calling a healthy stack broken (a one-shot migration that exited 0 is
 * success, not a dead container) and calling a stale stack shipped (a container running last
 * release's digest, or a migration that never ran).
 *
 * The fetcher below REFUSES a URL nobody recorded rather than answering a default. A fake
 * that always answers would make `verify` pass against requests it never should have sent --
 * which is exactly the bug in "compare `latest` to `latest`" that the release-tag argument
 * exists to close.
 */

// biome-ignore-all lint/nursery/useUnicodeRegex: Two regexes over ASCII-only input where the `u` flag changes nothing.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Literal `${...}` in strings that are compose-file and shell templates, where the placeholder is the content.

// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.
import { expect, test as it } from "bun:test";

import { type Config, type Deps, oneShotServices, verify } from "./dokploy.ts";

const ENDPOINT = "https://panel.example.test/api";
const CFG: Config = { endpoint: ENDPOINT, apiKey: "test-key", composeId: "compose-1" };
const APP = "undercroft-test";

const WORKER_DIGEST = `sha256:${"1".repeat(64)}`;
const CONTROL_DIGEST = `sha256:${"2".repeat(64)}`;
const STALE_DIGEST = `sha256:${"9".repeat(64)}`;

/** Two released services: one meant to stay up, one meant to run and exit. */
const COMPOSE = [
  "services:",
  "  worker:",
  "    image: ghcr.io/muitneliss/undercroft-worker:${IMAGE_TAG:-latest}",
  "    depends_on:",
  "      db-migrate:",
  "        condition: service_completed_successfully",
  "  db-migrate:",
  "    image: ghcr.io/muitneliss/undercroft-control-plane:${IMAGE_TAG:-latest}",
  '    command: ["bun", "run", "migrate"]',
].join("\n");

interface Recorder {
  readonly deps: Deps;
  readonly lines: string[];
  readonly asked: string[];
}

function recorder(recorded: Record<string, unknown>): Recorder {
  const lines: string[] = [];
  const asked: string[] = [];
  const deps: Deps = {
    fetch: (input: string) => {
      asked.push(input);
      const body = recorded[input];
      if (body === undefined) {
        const known = Object.keys(recorded).join("\n  ");
        return Promise.reject(
          new Error(`no recorded response for ${input}\nrecorded:\n  ${known}`),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    },
    sleep: () => Promise.resolve(),
    log: (line: string) => lines.push(line),
    now: () => 0,
  };
  return { deps, lines, asked };
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
}

/** A stack where both services are healthy, minus whatever the scenario spoils. */
function routes(scenario: Scenario = {}): Record<string, unknown> {
  const tag = scenario.tag ?? "latest";
  const workerState = scenario.workerState ?? "running";
  const migrateState = scenario.migrateState ?? ({ Status: "exited", ExitCode: 0 } as const);

  return {
    [`${ENDPOINT}/compose.one?composeId=compose-1`]: {
      composeId: "compose-1",
      name: "undercroft",
      appName: APP,
      composeFile: COMPOSE,
      command: "docker compose up -d --pull always --wait --wait-timeout 600 --remove-orphans",
      sourceType: "raw",
      composeStatus: "done",
    },
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
  const { deps, lines } = recorder(routes({ tag: "v1.3.0" }));

  await verify(CFG, deps, "", "v1.3.0");

  expect(lines).toContain("verify ok");
});

it("a one-shot service that exited non-zero fails the release", async () => {
  const { deps } = recorder(
    routes({ tag: "v1.3.0", migrateState: { Status: "exited", ExitCode: 1 } }),
  );

  await expect(verify(CFG, deps, "", "v1.3.0")).rejects.toThrow(
    /db-migrate: one-shot service is exited with exit code 1/u,
  );
});

it("a one-shot service still running when verify asks fails the release", async () => {
  const { deps } = recorder(
    routes({ tag: "v1.3.0", migrateState: { Status: "running", ExitCode: 0 } }),
  );

  await expect(verify(CFG, deps, "", "v1.3.0")).rejects.toThrow(
    /db-migrate: one-shot service is running/u,
  );
});

it("a one-shot service whose inspect carries no State is refused, not assumed complete", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", migrateState: "omitted" }));

  await expect(verify(CFG, deps, "", "v1.3.0")).rejects.toThrow(
    /db-migrate: docker.getConfig returned no State/u,
  );
});

it("a one-shot service that exited 0 on the wrong image still fails", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", migrateDigest: STALE_DIGEST }));

  await expect(verify(CFG, deps, "", "v1.3.0")).rejects.toThrow(
    new RegExp(`db-migrate: running ${STALE_DIGEST}`),
  );
});

it("a long-running service that is not running still fails the release", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", workerState: "exited" }));

  await expect(verify(CFG, deps, "", "v1.3.0")).rejects.toThrow(/worker: container is exited/u);
});

it("a long-running service on a stale digest fails the release", async () => {
  const { deps } = recorder(routes({ tag: "v1.3.0", workerDigest: STALE_DIGEST }));

  await expect(verify(CFG, deps, "", "v1.3.0")).rejects.toThrow(
    new RegExp(`worker: running ${STALE_DIGEST}`),
  );
});

it("the release tag, not the panel's moving pointer, is what ghcr is asked for", async () => {
  // The recorded routes answer only `v1.3.0`, so reaching for `latest` is a refusal rather
  // than a pass -- which is the whole point of the fetcher refusing unmodelled requests.
  const { deps, asked } = recorder(routes({ tag: "v1.3.0" }));

  await verify(CFG, deps, "", "v1.3.0");

  expect(asked).toContain("https://ghcr.io/v2/muitneliss/undercroft-worker/manifests/v1.3.0");
  expect(asked).not.toContain("https://ghcr.io/v2/muitneliss/undercroft-worker/manifests/latest");
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
