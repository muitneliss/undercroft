/**
 * The deploy client. CI runs this; an operator runs the same commands by hand.
 *
 *   bun run scripts/dokploy.ts preflight | deploy | verify | smoke | logs | status
 *   bun run scripts/dokploy.ts outage on | off      (TEMPORARY, ADR 0136)
 *
 * The Dokploy API is the only channel for changes. SSH is for reading state, never for
 * making one: a direct edit on the host bypasses Dokploy's record of what it deployed, and
 * the next deploy silently reverts it.
 *
 * Three things here look like over-engineering and are not. Each is a failure that has
 * already shipped somewhere:
 *
 *   - `deploy` snapshots the deployment ids BEFORE triggering and refuses to read a verdict
 *     out of a record that already existed. `compose.deploy` only queues, so for the first
 *     seconds the newest record is still the PREVIOUS release's -- `status: done`, finished
 *     hours ago, exit 0. That is how a release reports success while the host goes on
 *     running the build before it.
 *   - `verify` compares image CONFIG digests against what ghcr serves, because Dokploy
 *     reports `done` for a deploy that changed nothing. Config digest, not index digest:
 *     buildx attestations change the index digest on every build, so two builds of an
 *     identical image compare unequal there and equal here.
 *   - Reads retry; the trigger never does. A retried trigger queues a second concurrent
 *     `docker compose up` against the same stack.
 *
 * Credentials come from the environment and are never written to a file -- all three or
 * none, so a half-finished secret wiring cannot reach for a developer's compose id and
 * deploy something nobody asked for.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const POLL_INTERVAL_MS = 10_000;
const DEPLOYMENT_APPEARS_WITHIN_MS = 300_000;
const DEPLOYMENT_SETTLES_WITHIN_MS = 3_600_000;
const SMOKE_SETTLE_MS = 120_000;
const SMOKE_INTERVAL_MS = 5000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

/** Images this repo publishes. Everything else in the stack is upstream and not ours to verify. */
const RELEASED_IMAGE_PREFIX = "ghcr.io/muitneliss/undercroft-";

/** A trailing slash on the configured endpoint, so paths join without doubling it. */
const TRAILING_SLASH = /\/$/u;
/** A compose service key at the top level: exactly two spaces of indent. */
const TOP_LEVEL_SERVICE = /^ {2}(?<name>[a-z0-9][a-z0-9-]*):\s*$/u;
const IMAGE_LINE = /^\s+image:\s*(?<image>\S+)\s*$/u;
/** A key at any depth, used to track which service a `depends_on` entry sits under. */
const NESTED_NAME = /^\s+(?<name>[a-z0-9][a-z0-9-]*):\s*$/u;
const COMPLETED_CONDITION = /^\s+condition:\s*service_completed_successfully\s*$/u;
/** Blank lines at the very end of a file, which YAML does not read and a paste can add. */
const TRAILING_NEWLINES = /\n+$/u;
/** The `-p <project>` of a stored compose command. */
const COMPOSE_PROJECT = /(?:^|\s)-p\s+(?<name>\S+)/u;

/** The repository the panel clones, as GitHub's API names it. */
const REPOSITORY = "muitneliss/undercroft";

/** The compose file Dokploy deploys, relative to the repo root. */
const SERVER_COMPOSE = "deploy/compose/docker-compose.server.yml";

/**
 * TEMPORARY (ADR 0136): the override that makes the host build the first-party images from
 * `main` while GitHub Actions cannot. Named only by `storedCommand("outage")`.
 */
const BUILD_OVERRIDE = "deploy/compose/docker-compose.server.build.yml";

/**
 * Where the panel clones that file from (ADR 0049). The panel holds no copy of it: every
 * deploy clones this branch, so the file in the repo is the only one there is. Over SSH, with
 * the read-only deploy key the panel holds, because the repository is private (ADR 0121).
 */
const COMPOSE_SOURCE = {
  url: `git@github.com:${REPOSITORY}.git`,
  branch: "main",
} as const;

/** The same file on the same branch, read the way the host is about to read it. */
const COMPOSE_ON_BRANCH_URL = `https://api.github.com/repos/${REPOSITORY}/contents/${SERVER_COMPOSE}?ref=${COMPOSE_SOURCE.branch}`;

/**
 * Flags the stored compose command must carry. Asserted by `preflight`, never written by CI.
 * Dokploy runs the command from the clone's root and writes `.env` beside the compose file,
 * so both paths are the file's own; a command still naming `docker-compose.yml` would fail on
 * the host, after the old stack had already been told to go.
 */
const ENV_FILE_FLAG = "--env-file deploy/compose/.env";
const REQUIRED_COMMAND_FLAGS = [
  ENV_FILE_FLAG,
  `-f ${SERVER_COMPOSE}`,
  "--pull always",
  "--wait",
  "--wait-timeout",
  "--remove-orphans",
];

/**
 * The whole stored command, for each way the host can run. Written once here so that a
 * switch back cannot restore a command that differs from the one `preflight` asserts: the
 * `released` command carries every flag above, and a test holds them together.
 *
 * `outage` (ADR 0136, TEMPORARY) layers the build override on the server file and builds
 * rather than pulls. It passes no `--pull` on purpose: the flag overrides every service's own
 * `pull_policy`, so `--pull missing` would send `db-migrate` and `kestra-flows` to Docker Hub
 * for `undercroft-control-plane:main`, an image only this host's build can produce. Without
 * it, each service keeps the policy the override gives it, and an upstream image is pulled
 * only when missing, which is compose's default.
 */
export function storedCommand(project: string, mode: "released" | "outage"): string {
  const files =
    mode === "released" ? `-f ${SERVER_COMPOSE}` : `-f ${SERVER_COMPOSE} -f ${BUILD_OVERRIDE}`;
  const images = mode === "released" ? "--pull always" : "--build";
  return `compose -p ${project} ${ENV_FILE_FLAG} ${files} up -d ${images} --wait --wait-timeout 600 --remove-orphans`;
}

export interface Config {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly composeId: string;
}

/**
 * Narrower than `typeof fetch` on purpose: the client uses a URL, a method, headers and a
 * body, so that is the seam a test has to satisfy. Widening it to the platform type would
 * drag in `preconnect` and make an honest in-memory fetcher unassignable.
 */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Deps {
  readonly fetch: Fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly now: () => number;
}

export interface Deployment {
  readonly deploymentId: string;
  readonly status: string;
  readonly title: string;
  readonly createdAt: string;
  readonly errorMessage: string | null;
}

export interface Container {
  readonly containerId: string;
  readonly name: string;
  readonly state: string;
  readonly status: string;
}

/**
 * `docker.getConfig` is Docker's container inspect. `Image` is the image ID -- the config
 * digest, which is what ghcr's manifest serves and what makes two builds of an identical
 * image compare equal. `State` is optional because it is read to decide whether a one-shot
 * job succeeded, and a payload that does not carry it must fail loudly rather than be
 * treated as "fine".
 */
export interface ContainerConfig {
  readonly Image: string;
  readonly Config: { readonly Image: string };
  readonly State?: { readonly Status: string; readonly ExitCode: number };
}

export function configFromEnv(env: Record<string, string | undefined>): Config {
  const endpoint = env.DOKPLOY_API_ENDPOINT ?? "";
  const apiKey = env.DOKPLOY_API_KEY ?? "";
  const composeId = env.DOKPLOY_COMPOSE_ID ?? "";
  const missing = [
    endpoint === "" ? "DOKPLOY_API_ENDPOINT" : "",
    apiKey === "" ? "DOKPLOY_API_KEY" : "",
    composeId === "" ? "DOKPLOY_COMPOSE_ID" : "",
  ].filter((name) => name !== "");
  if (missing.length > 0) {
    throw new Error(`not configured: ${missing.join(", ")} must be set`);
  }
  return { endpoint: endpoint.replace(TRAILING_SLASH, ""), apiKey, composeId };
}

export const realDeps: Deps = {
  fetch: (input, init): Promise<Response> => globalThis.fetch(input, init ?? {}),
  sleep: (ms): Promise<void> => new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, ms)),
  log: (line): boolean => process.stdout.write(`${line}\n`),
  now: () => Date.now(),
};

/**
 * One HTTP primitive. A payload makes it a write, and a write is never retried whatever
 * the caller asked for.
 *
 * The explicit User-Agent matters: the panel is behind Cloudflare, which answers a default
 * runtime agent string with a block that reads exactly like an authentication failure.
 */
export async function callApi<T>(
  cfg: Config,
  deps: Deps,
  endpoint: string,
  options: { payload?: unknown; query?: Record<string, string>; retries?: number } = {},
): Promise<T> {
  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
  const url = `${cfg.endpoint}/${endpoint}${query}`;
  const isWrite = options.payload !== undefined;
  const attempts = isWrite ? 1 : (options.retries ?? 0) + 1;

  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await deps.fetch(url, {
      method: isWrite ? "POST" : "GET",
      headers: {
        "x-api-key": cfg.apiKey,
        Accept: "application/json",
        "User-Agent": "undercroft-deploy/1.0",
        ...(isWrite ? { "Content-Type": "application/json" } : {}),
      },
      ...(isWrite ? { body: JSON.stringify(options.payload) } : {}),
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    lastError = `${endpoint} -> HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
      break;
    }
    await deps.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(lastError);
}

export async function deployments(cfg: Config, deps: Deps): Promise<Deployment[]> {
  return await callApi<Deployment[]>(cfg, deps, "deployment.allByCompose", {
    query: { composeId: cfg.composeId },
    retries: 3,
  });
}

function newest(records: readonly Deployment[]): Deployment | undefined {
  return [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Trigger a deploy and wait for the record it creates -- not for whatever record happened
 * to be newest when we asked.
 */
export async function deployAndWait(
  cfg: Config,
  deps: Deps,
  options: { title: string; description: string },
): Promise<Deployment> {
  const known = new Set((await deployments(cfg, deps)).map((d) => d.deploymentId));
  deps.log(`triggering deploy of ${options.title} (${known.size} prior deployments)`);

  await callApi(cfg, deps, "compose.deploy", {
    payload: { composeId: cfg.composeId, title: options.title, description: options.description },
  });

  const startedAt = deps.now();

  // Phase one: wait for a record that did not exist before the trigger. Anything already
  // in the list belongs to an earlier release and says nothing about this one.
  let ours: Deployment | undefined;
  while (ours === undefined) {
    await deps.sleep(POLL_INTERVAL_MS);
    ours = newest((await deployments(cfg, deps)).filter((d) => !known.has(d.deploymentId)));
    if (ours === undefined && deps.now() - startedAt > DEPLOYMENT_APPEARS_WITHIN_MS) {
      throw new Error(
        "no new deployment record appeared; the Dokploy queue is not draining. " +
          "Check the panel before triggering again -- a second trigger queues a " +
          "concurrent `docker compose up` against the same stack.",
      );
    }
  }
  const { deploymentId } = ours;
  deps.log(`deployment ${deploymentId} queued`);

  // Phase two: watch that record, and only that record, until it settles.
  for (let current = ours; ; ) {
    if (current.status === "done") {
      deps.log(`deployment ${deploymentId} done`);
      return current;
    }
    if (current.status === "error") {
      throw new Error(`deployment ${deploymentId} failed: ${current.errorMessage ?? "no message"}`);
    }
    if (deps.now() - startedAt > DEPLOYMENT_SETTLES_WITHIN_MS) {
      throw new Error(`deployment ${deploymentId} still ${current.status}; giving up`);
    }
    await deps.sleep(POLL_INTERVAL_MS);
    const records = await deployments(cfg, deps);
    current = records.find((d) => d.deploymentId === deploymentId) ?? current;
  }
}

/**
 * The fields of `compose.one` this client reads. `composeFile` is deliberately absent: under
 * a git source it is whatever was last pasted into the panel and is never deployed, so a
 * reader that trusted it would be verifying a file nobody runs.
 */
interface ComposeRecord {
  readonly composeId: string;
  readonly name: string;
  readonly appName: string;
  readonly command: string;
  readonly sourceType: string;
  readonly customGitUrl: string | null;
  readonly customGitBranch: string | null;
  readonly composePath: string;
  readonly autoDeploy: boolean | null;
  readonly composeStatus: string;
  /** The secret in the panel's deploy webhook URL. Read by `outage on` alone, never logged. */
  readonly refreshToken: string | null;
}

export async function composeRecord(cfg: Config, deps: Deps): Promise<ComposeRecord> {
  return await callApi<ComposeRecord>(cfg, deps, "compose.one", {
    query: { composeId: cfg.composeId },
    retries: 3,
  });
}

/**
 * Resolve the compose-style `${VAR}` and `${VAR:-default}` an image tag carries. The panel
 * stores the file unexpanded (`...undercroft-worker:${IMAGE_TAG:-latest}`), so the running
 * tag has to be reconstructed from the same environment the deploy used before it can be
 * looked up in ghcr.
 */
export function expandEnv(value: string, env: Record<string, string | undefined>): string {
  return value.replace(
    /\$\{(?<name>[A-Za-z_][A-Za-z0-9_]*)(?::-(?<fallback>[^}]*))?\}/gu,
    (...args: unknown[]) => {
      const { name, fallback } = args.at(-1) as { name: string; fallback?: string };
      const resolved = env[name];
      return resolved !== undefined && resolved !== "" ? resolved : (fallback ?? "");
    },
  );
}

/**
 * Services whose image this repo publishes, read out of the compose file. Line-wise rather
 * than through a YAML parser: the file is ours and plain, and a parser to read it buys nothing.
 */
export function releasedServices(
  composeFile: string,
  env: Record<string, string | undefined> = process.env,
): { service: string; image: string }[] {
  const found: { service: string; image: string }[] = [];
  let service = "";
  for (const line of composeFile.split("\n")) {
    const matchedService = TOP_LEVEL_SERVICE.exec(line)?.groups?.name;
    if (matchedService !== undefined) {
      service = matchedService;
    }
    const matchedImage = IMAGE_LINE.exec(line)?.groups?.image;
    if (matchedImage?.startsWith(RELEASED_IMAGE_PREFIX) === true) {
      found.push({ service, image: expandEnv(matchedImage, env) });
    }
  }
  return found;
}

/**
 * Services the compose file declares are expected to run to completion, rather than to stay
 * up -- `db-migrate` applies the schema and exits, and `verify` must not read that as a dead
 * container.
 *
 * Derived from the `depends_on: { <name>: { condition: service_completed_successfully } }`
 * entries rather than from a list of names kept here. That declaration is what already makes
 * the stack wait for the job, so it is the one place the intent is stated; a list here would
 * be a second source of truth, and the failure when they disagree is a green deploy that
 * never ran its migration. Line-wise for the same reason as `releasedServices` above.
 */
export function oneShotServices(composeFile: string): Set<string> {
  const found = new Set<string>();
  let candidate = "";
  for (const line of composeFile.split("\n")) {
    const matchedName = NESTED_NAME.exec(line)?.groups?.name;
    if (matchedName !== undefined) {
      candidate = matchedName;
    }
    if (COMPLETED_CONDITION.test(line) && candidate !== "") {
      found.add(candidate);
    }
  }
  return found;
}

/**
 * What is wrong with where the panel gets its compose file, one line per fault; empty when
 * nothing is.
 *
 * The panel used to hold a pasted copy of the file (a "raw" source). The copy drifted far
 * enough to run a service this repo had deleted (Metabase, ADR 0020), and later stopped a
 * release because a merged change to the file had never been pasted. A git source has no
 * copy to drift: every deploy clones the branch. So the question this answers is not "is the
 * copy right" but "is there a copy at all", plus the one setting that would make a clone
 * dangerous -- `autoDeploy`, which rolls out every push to main while images change only on
 * a release (ADR 0008).
 */
function sourceFaults(compose: ComposeRecord): string[] {
  const expected: [string, unknown, unknown][] = [
    ["sourceType", compose.sourceType, "git"],
    ["customGitUrl", compose.customGitUrl, COMPOSE_SOURCE.url],
    ["customGitBranch", compose.customGitBranch, COMPOSE_SOURCE.branch],
    ["composePath", compose.composePath, SERVER_COMPOSE],
    ["autoDeploy", compose.autoDeploy, false],
  ];
  return expected
    .filter(([, held, wanted]) => held !== wanted)
    .map(
      ([field, held, wanted]) =>
        `${field} is ${JSON.stringify(held)}, not ${JSON.stringify(wanted)}`,
    );
}

/**
 * How the file on the branch the host clones differs from the one this checkout carries, or
 * `null` when it does not. The returned string is the whole complaint, so the wording has
 * one owner.
 *
 * The host clones the branch's head at deploy time, not the release's commit, so a change to
 * the file merged while a release's images were building would ship beside images that
 * predate it. That is a pairing nobody tested, and it would deploy green: refuse it here,
 * where failing is free, and let the next release carry the change with its own images.
 *
 * Line endings and trailing blank lines are normalized away first; neither means anything
 * in YAML. Everything else compares byte for byte.
 */
function branchDrift(onBranch: string, expected: string): string | null {
  const held = normalizeCompose(onBranch).split("\n");
  const published = normalizeCompose(expected).split("\n");
  const longer = held.length >= published.length ? held : published;
  const at = longer.findIndex((_line, index) => held[index] !== published[index]);
  if (at === -1) {
    return null;
  }
  return (
    `${SERVER_COMPOSE} on ${COMPOSE_SOURCE.branch} is not the one this checkout carries ` +
    `(first difference at line ${at + 1}, ${COMPOSE_SOURCE.branch} ${held.length} lines, ` +
    `checkout ${published.length}).\n` +
    `  ${COMPOSE_SOURCE.branch}: ${quoteLine(held[at])}\n` +
    `  checkout: ${quoteLine(published[at])}\n` +
    `  The host deploys ${COMPOSE_SOURCE.branch}'s file. Cut a release from it, or deploy ` +
    "from a checkout of it, so the file and the images it names ship together."
  );
}

/** A line of a compose file as it reads in an error, or where the file ran out. */
function quoteLine(line: string | undefined): string {
  return line === undefined ? "(end of file)" : `\`${line}\``;
}

function normalizeCompose(text: string): string {
  return text.replaceAll("\r\n", "\n").replace(TRAILING_NEWLINES, "");
}

/**
 * The compose file in this checkout. Read at the entrypoint rather than inside `preflight`
 * and `verify`, so the file stays a value a test can hand in.
 */
export function publishedCompose(): string {
  return readFileSync(join(import.meta.dirname, "..", SERVER_COMPOSE), "utf8");
}

/**
 * The compose file on the branch the host clones, fetched from GitHub's contents API rather
 * than raw.githubusercontent.com, whose CDN serves a file up to five minutes stale -- long
 * enough to call a just-merged change absent. The token only lifts the anonymous rate limit;
 * the repository is public.
 */
async function composeOnBranch(deps: Deps, githubToken: string): Promise<string> {
  const response = await deps.fetch(COMPOSE_ON_BRANCH_URL, {
    headers: {
      Accept: "application/vnd.github.raw",
      "User-Agent": "undercroft-deploy/1.0",
      ...(githubToken === "" ? {} : { Authorization: `Bearer ${githubToken}` }),
    },
  });
  if (!response.ok) {
    throw new Error(
      `reading ${SERVER_COMPOSE} on ${COMPOSE_SOURCE.branch}: HTTP ${response.status}`,
    );
  }
  return await response.text();
}

/**
 * The gate before anything is queued, when failing is free: the panel must clone this repo's
 * compose file rather than hold a copy of it, the file it will clone must be the one this
 * checkout carries, that file must name published images, and the command must pull them.
 *
 * `--pull always` is what makes a moving `latest` fetch the release that was just built;
 * without it the stack restarts on the image it already has and reports success. `--wait`
 * is what stops a crash-looping container from deploying green.
 */
export async function preflight(
  cfg: Config,
  deps: Deps,
  expected: string,
  githubToken = "",
): Promise<void> {
  const compose = await composeRecord(cfg, deps);
  deps.log(`compose ${compose.name} (${compose.appName}), source ${compose.sourceType}`);

  const faults = sourceFaults(compose);
  if (faults.length > 0) {
    throw new Error(
      `the panel does not clone ${SERVER_COMPOSE} from ${COMPOSE_SOURCE.url}@${COMPOSE_SOURCE.branch}:\n` +
        `  ${faults.join("\n  ")}\n` +
        "  Set it in the panel (or with compose.update) rather than here: CI does not write " +
        "the panel's configuration. See docs/runbook/deployment.md." +
        (compose.autoDeploy === true
          ? "\n  If Actions outage mode is on (ADR 0136), this refusal is expected; " +
            "`task cd:outage-off` is the way back."
          : ""),
    );
  }
  deps.log(`  clones ${SERVER_COMPOSE} from ${COMPOSE_SOURCE.branch}, autoDeploy off`);

  const drift = branchDrift(await composeOnBranch(deps, githubToken), expected);
  if (drift !== null) {
    throw new Error(drift);
  }
  deps.log(`  ${COMPOSE_SOURCE.branch} carries this checkout's ${SERVER_COMPOSE}`);

  const services = releasedServices(expected);
  if (services.length === 0) {
    throw new Error(
      `${SERVER_COMPOSE} references no ${RELEASED_IMAGE_PREFIX}* image. The host deploys ` +
        "the images a release published and `verify` proves by digest; it does not build.",
    );
  }
  for (const { service, image } of services) {
    deps.log(`  ${service} -> ${image}`);
  }

  const missing = REQUIRED_COMMAND_FLAGS.filter((flag) => !compose.command.includes(flag));
  if (missing.length > 0) {
    throw new Error(
      `the stored compose command is missing ${missing.join(", ")}.\n` +
        `  stored: ${compose.command === "" ? "(Dokploy default, which builds)" : compose.command}\n` +
        "  Fix it in the panel (or with compose.update) rather than here: CI does not write " +
        "the panel's configuration, so a drift must be seen and repaired by a human.",
    );
  }
  deps.log("preflight ok");
}

/** The config digest ghcr currently serves for a tag, on linux/amd64. */
async function publishedConfigDigest(deps: Deps, image: string, token: string): Promise<string> {
  const [repoAndHost, tag = "latest"] = image.split(":");
  const repo = (repoAndHost ?? "").replace("ghcr.io/", "");
  const accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(",");

  const pull = await deps.fetch(
    `https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`,
    { headers: token === "" ? {} : { Authorization: `Basic ${token}` } },
  );
  if (!pull.ok) {
    throw new Error(`ghcr token for ${repo}: HTTP ${pull.status}`);
  }
  const bearer = ((await pull.json()) as { token: string }).token;

  async function get(reference: string): Promise<Record<string, unknown>> {
    const response = await deps.fetch(`https://ghcr.io/v2/${repo}/manifests/${reference}`, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: accept },
    });
    if (!response.ok) {
      throw new Error(`ghcr manifest ${repo}:${reference}: HTTP ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  let manifest = await get(tag);
  const manifests = manifest.manifests as
    | { digest: string; platform?: { os: string; architecture: string } }[]
    | undefined;
  if (manifests !== undefined) {
    const amd64 = manifests.find(
      (m) => m.platform?.os === "linux" && m.platform.architecture === "amd64",
    );
    if (amd64 === undefined) {
      throw new Error(`${image} has no linux/amd64 manifest`);
    }
    manifest = await get(amd64.digest);
  }
  const config = manifest.config as { digest: string } | undefined;
  if (config === undefined) {
    throw new Error(`${image} manifest carries no config digest`);
  }
  return config.digest;
}

/**
 * Prove the host runs what was published. Dokploy reports `done` for a deploy that changed
 * nothing, and every smoke probe passes against the old images, so this runs first.
 *
 * `releaseTag` is the release being rolled out. The HOST resolves `${IMAGE_TAG:-latest}` from
 * the panel's environment and so pulls `latest`; passing the tag here makes the ghcr side of
 * the comparison the IMMUTABLE `vX.Y.Z` manifest instead. A pass then means "the running
 * digest is the digest ghcr serves for this release", which is the claim worth making --
 * comparing `latest` against `latest` proves only that a moving pointer equals itself.
 *
 * The release publishes both tags to one digest, so they must agree. Two ways they do not,
 * and both should fail here rather than pass quietly: `latest` moved after this deploy
 * pulled, or an operator pinned `IMAGE_TAG` to an older tag for a rollback and never put it
 * back, in which case the host is knowingly not running this release.
 *
 * Empty `releaseTag` keeps the old behaviour for an operator running `verify` by hand.
 */
interface ServiceCheck {
  readonly cfg: Config;
  readonly deps: Deps;
  readonly ghcrToken: string;
  readonly service: string;
  readonly image: string;
  readonly appName: string;
  readonly containers: readonly Container[];
  /** Whether this service is meant to run to completion rather than stay up. */
  readonly oneShot: boolean;
}

/**
 * One service, checked. Returns what is wrong with it, or null when it is right.
 *
 * A one-shot service is meant to exit and a long-running one is meant not to, so they are
 * asked different questions -- reading the wrong expectation either way is a false verdict.
 * Absence of evidence is never success: without `State` there is no exit code, and "not
 * running" is exactly what a completed job and a crashed one have in common.
 *
 * The digest check is reached by BOTH kinds, because a migration that exited 0 on last
 * release's image is still the wrong thing having run, and the digest is the only way to see
 * it. Config digest, not index digest: see the module docstring.
 */
type VerifiedService = { ok: true; digest: string } | { ok: false; problem: string };

async function verifyService(check: ServiceCheck): Promise<VerifiedService> {
  const { cfg, deps, service, image, appName, containers, oneShot } = check;

  const container = containers.find((c) => c.name.includes(`-${service}-`));
  if (container === undefined) {
    return { ok: false, problem: `${service}: no container matching ${appName}-${service}-*` };
  }

  const config = await callApi<ContainerConfig>(cfg, deps, "docker.getConfig", {
    query: { containerId: container.containerId },
    retries: 3,
  });

  if (oneShot) {
    const state = config.State;
    if (state === undefined) {
      return {
        ok: false,
        problem: `${service}: docker.getConfig returned no State, so no exit code to read`,
      };
    }
    if (state.Status !== "exited" || state.ExitCode !== 0) {
      return {
        ok: false,
        problem: `${service}: one-shot service is ${state.Status} with exit code ${state.ExitCode}, expected exited 0`,
      };
    }
  } else if (container.state !== "running") {
    return {
      ok: false,
      problem: `${service}: container is ${container.state} (${container.status})`,
    };
  }

  const expected = await publishedConfigDigest(deps, image, check.ghcrToken);
  if (config.Image !== expected) {
    return {
      ok: false,
      problem: `${service}: running ${config.Image} (from ${config.Config.Image}), ghcr serves ${expected} for ${image}`,
    };
  }
  return { ok: true, digest: expected };
}

/**
 * What `verify` checks the host against. `composeFile` is this checkout's file, which
 * `preflight` proved is the one the host cloned; the panel's own `composeFile` field is a
 * stale paste under a git source and is never read.
 */
export interface Rollout {
  readonly composeFile: string;
  readonly ghcrToken: string;
  readonly releaseTag?: string;
}

export async function verify(
  cfg: Config,
  deps: Deps,
  { composeFile, ghcrToken, releaseTag = "" }: Rollout,
): Promise<void> {
  const compose = await composeRecord(cfg, deps);
  const env = releaseTag === "" ? process.env : { ...process.env, IMAGE_TAG: releaseTag };
  const services = releasedServices(composeFile, env);
  if (services.length === 0) {
    throw new Error("nothing to verify: no released images in compose");
  }
  const oneShot = oneShotServices(composeFile);

  const containers = await callApi<Container[]>(cfg, deps, "docker.getContainersByAppNameMatch", {
    query: { appName: compose.appName },
    retries: 3,
  });

  const problems: string[] = [];
  for (const { service, image } of services) {
    const checked = await verifyService({
      cfg,
      deps,
      ghcrToken,
      service,
      image,
      appName: compose.appName,
      containers,
      oneShot: oneShot.has(service),
    });
    if (!checked.ok) {
      problems.push(checked.problem);
      continue;
    }
    const ran = oneShot.has(service) ? "ran to completion on" : "runs";
    deps.log(
      `  ${service} ${ran} the published image ${image} (${checked.digest.slice(0, 19)}...)`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`the host is not running what was published:\n  ${problems.join("\n  ")}`);
  }
  deps.log("verify ok");
}

/**
 * One shared settle budget rather than a sleep per probe: after containers are replaced,
 * Traefik needs a moment to re-register its routers, and that window answers 404 from a
 * perfectly healthy stack.
 */
export async function smoke(deps: Deps, urls: readonly string[]): Promise<void> {
  const deadline = deps.now() + SMOKE_SETTLE_MS;
  const pending = new Set(urls);

  for (;;) {
    for (const url of [...pending]) {
      try {
        const response = await deps.fetch(url, {
          headers: { "User-Agent": "undercroft-deploy/1.0" },
        });
        if (response.ok) {
          deps.log(`  ${url} -> ${response.status}`);
          pending.delete(url);
        }
      } catch {
        // Still settling; the deadline below is the only thing that ends this loop.
      }
    }
    if (pending.size === 0) {
      deps.log("smoke ok");
      return;
    }
    if (deps.now() > deadline) {
      throw new Error(`still failing after ${SMOKE_SETTLE_MS / 1000}s: ${[...pending].join(", ")}`);
    }
    await deps.sleep(SMOKE_INTERVAL_MS);
  }
}

export async function printLogs(cfg: Config, deps: Deps): Promise<void> {
  const record = newest(await deployments(cfg, deps));
  if (record === undefined) {
    deps.log("no deployments to read");
    return;
  }
  deps.log(`--- ${record.title} (${record.status}, ${record.createdAt}) ---`);
  const logs = await callApi<string>(cfg, deps, "deployment.readLogs", {
    query: { deploymentId: record.deploymentId, tail: "400" },
    retries: 2,
  });
  deps.log(typeof logs === "string" ? logs : JSON.stringify(logs));
}

// --- Actions outage mode -------------------------------------------------------------------
//
// TEMPORARY (ADR 0136). GitHub Actions cannot run until its minutes reset, so no release can
// build an image and nothing can deploy one. `outage on` makes Dokploy deploy every push to
// `main` by building it on the host; `outage off` puts back exactly what `preflight` asserts,
// then runs `preflight`, so a switch back that missed anything fails where a person is
// watching. Delete this section, its two tasks and the build override in the PR that ends
// ADR 0136.
//
// These two commands WRITE the panel's configuration, which CI never does (ADR 0008). They are
// a person's tools, run from a terminal, and no workflow calls them -- none can run anyway.

/** What `outage` needs from GitHub. `gh` in production; an in-memory repository in a test. */
export interface GitHub {
  /** Turn one workflow, named by its file, on or off. Idempotent either way. */
  readonly setWorkflow: (file: string, enabled: boolean) => Promise<void>;
  /** The repository's webhooks, each with the URL it posts to. */
  readonly hooks: () => Promise<{ id: number; url: string }[]>;
  /** Add a webhook that posts every push to `url`, as JSON. */
  readonly addPushHook: (url: string) => Promise<void>;
  readonly removeHook: (id: number) => Promise<void>;
}

/** Every workflow in `.github/workflows`, so none is left queuing runs that cannot start. */
const WORKFLOWS = [
  "ci.yml",
  "release.yml",
  "build-images.yml",
  "deploy.yml",
  "blog.yml",
  "desktop.yml",
  "visual.yml",
] as const;

/**
 * What a push to `main` must touch to be worth a deploy: everything an image or the compose
 * file is built from. A push that changes only docs, the wiki or a workflow builds nothing.
 */
const OUTAGE_WATCH_PATHS = [
  "apps/**",
  "packages/**",
  "deploy/**",
  "flows/**",
  "specs/**",
  "skills/**",
  "package.json",
  "bun.lock",
];

/**
 * Where the panel's deploy webhook for a compose lives, up to the refresh token. Under the
 * configured endpoint, so `outage off` removes the hook `outage on` made and no other.
 */
function deployHookPrefix(cfg: Config): string {
  return `${cfg.endpoint}/deploy/compose/`;
}

/**
 * The compose project the stored command names. Read from the command rather than assumed
 * from `appName`: a switch that changed `-p` would bring up a SECOND stack with empty
 * volumes beside the real one. No `-p` is refused rather than guessed.
 */
function composeProject(command: string): string {
  const project = COMPOSE_PROJECT.exec(command)?.groups?.name;
  if (project === undefined) {
    throw new Error(
      "the stored compose command names no project (-p), so there is no project to keep.\n" +
        `  stored: ${command === "" ? "(Dokploy default)" : command}\n` +
        "  Repair it in the panel first; see docs/runbook/deployment.md.",
    );
  }
  return project;
}

/** Only the three fields a mode owns. Never `env`: it replaces the whole credential blob. */
async function setPanelMode(
  cfg: Config,
  deps: Deps,
  mode: { autoDeploy: boolean; watchPaths: readonly string[] | null; command: string },
): Promise<void> {
  await callApi(cfg, deps, "compose.update", { payload: { composeId: cfg.composeId, ...mode } });
  deps.log(`  panel: autoDeploy ${mode.autoDeploy}, command ${mode.command}`);
}

export async function outageOn(cfg: Config, deps: Deps, github: GitHub): Promise<void> {
  const compose = await composeRecord(cfg, deps);
  const refreshToken = compose.refreshToken ?? "";
  if (refreshToken === "") {
    throw new Error("compose.one carries no refreshToken, so there is no deploy webhook to add");
  }
  await setPanelMode(cfg, deps, {
    autoDeploy: true,
    watchPaths: OUTAGE_WATCH_PATHS,
    command: storedCommand(composeProject(compose.command), "outage"),
  });

  for (const file of WORKFLOWS) {
    await github.setWorkflow(file, false);
  }
  deps.log(`  workflows disabled: ${WORKFLOWS.join(", ")}`);

  // The URL carries the panel's secret, so it is compared and sent, never printed.
  const url = `${deployHookPrefix(cfg)}${refreshToken}`;
  if ((await github.hooks()).some((hook) => hook.url === url)) {
    deps.log(`  push webhook to ${deployHookPrefix(cfg)}<refreshToken> already there`);
  } else {
    await github.addPushHook(url);
    deps.log(`  push webhook added to ${deployHookPrefix(cfg)}<refreshToken>`);
  }
  deps.log("outage mode on: the next push to main touching a watched path builds and deploys");
}

export async function outageOff(
  cfg: Config,
  deps: Deps,
  github: GitHub,
  rollout: { expected: string; githubToken: string },
): Promise<void> {
  const compose = await composeRecord(cfg, deps);
  await setPanelMode(cfg, deps, {
    autoDeploy: false,
    watchPaths: null,
    command: storedCommand(composeProject(compose.command), "released"),
  });

  for (const hook of await github.hooks()) {
    if (hook.url.startsWith(deployHookPrefix(cfg))) {
      await github.removeHook(hook.id);
      deps.log(`  push webhook ${hook.id} removed`);
    }
  }

  for (const file of WORKFLOWS) {
    await github.setWorkflow(file, true);
  }
  deps.log(`  workflows enabled: ${WORKFLOWS.join(", ")}`);

  await preflight(cfg, deps, rollout.expected, rollout.githubToken);
}

/**
 * `gh`, signed in as the person running it; it needs admin on the repository for webhooks.
 * Workflows are switched through the REST endpoints rather than `gh workflow disable`, which
 * refuses a workflow that is already disabled and so would make a re-run fail.
 */
async function gh(args: readonly string[], input?: string): Promise<string> {
  const child = Bun.spawn(["gh", ...args], {
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `gh ${args.slice(0, 4).join(" ")} exited ${code}: ${stderr.trim().slice(0, 300)}`,
    );
  }
  return stdout;
}

export const ghGitHub: GitHub = {
  setWorkflow: async (file, enabled) => {
    await gh([
      "api",
      "-X",
      "PUT",
      `repos/${REPOSITORY}/actions/workflows/${file}/${enabled ? "enable" : "disable"}`,
    ]);
  },
  hooks: async () => {
    const lines = await gh([
      "api",
      `repos/${REPOSITORY}/hooks`,
      "--paginate",
      "--jq",
      ".[] | {id, url: .config.url}",
    ]);
    return lines
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { id: number; url: string });
  },
  addPushHook: async (url) => {
    // The body goes on stdin, not the command line, so the secret in the URL is never in an
    // argument list another process can read. GitHub echoes the hook back; it is dropped.
    const body = {
      name: "web",
      active: true,
      events: ["push"],
      config: { url, content_type: "json", insecure_ssl: "0" },
    };
    await gh(
      ["api", "-X", "POST", `repos/${REPOSITORY}/hooks`, "--input", "-"],
      JSON.stringify(body),
    );
  },
  removeHook: async (id) => {
    await gh(["api", "-X", "DELETE", `repos/${REPOSITORY}/hooks/${id}`]);
  },
};

/** `outage on|off` from the command line, with `gh` and this checkout's compose file. */
async function outage(cfg: Config, deps: Deps, mode: string): Promise<void> {
  if (mode === "on") {
    await outageOn(cfg, deps, ghGitHub);
    return;
  }
  if (mode === "off") {
    await outageOff(cfg, deps, ghGitHub, {
      expected: publishedCompose(),
      githubToken: process.env.GITHUB_TOKEN ?? "",
    });
    return;
  }
  throw new Error("usage: dokploy.ts outage on|off");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "";
  const cfg = configFromEnv(process.env);
  const deps = realDeps;

  switch (command) {
    case "preflight":
      await preflight(cfg, deps, publishedCompose(), process.env.GITHUB_TOKEN ?? "");
      return;
    case "deploy": {
      const tag = process.argv[3] ?? process.env.IMAGE_TAG ?? "latest";
      await deployAndWait(cfg, deps, {
        title: tag,
        description: `rolled out by ${process.env.GITHUB_WORKFLOW ?? "an operator"}`,
      });
      return;
    }
    case "verify": {
      // ghcr serves public manifests anonymously; a token is needed only while a package
      // is private, and CI has one.
      const githubToken = process.env.GITHUB_TOKEN ?? "";
      const basic =
        githubToken === "" ? "" : Buffer.from(`x-access-token:${githubToken}`).toString("base64");
      // The release being rolled out, which is what the ghcr side is looked up under. Absent
      // by hand, where there is no release to name and `latest` is the honest question.
      await verify(cfg, deps, {
        composeFile: publishedCompose(),
        ghcrToken: basic,
        releaseTag: process.argv[3] ?? "",
      });
      return;
    }
    case "smoke": {
      const urls = process.argv.slice(3);
      if (urls.length === 0) {
        throw new Error("usage: smoke <url> [url...]");
      }
      await smoke(deps, urls);
      return;
    }
    case "logs":
      await printLogs(cfg, deps);
      return;
    case "status": {
      const compose = await composeRecord(cfg, deps);
      deps.log(`${compose.name}: ${compose.composeStatus}`);
      const record = newest(await deployments(cfg, deps));
      deps.log(record === undefined ? "no deployments" : `${record.title}: ${record.status}`);
      return;
    }
    case "outage":
      await outage(cfg, deps, process.argv[3] ?? "");
      return;
    default:
      throw new Error("usage: dokploy.ts preflight|deploy|verify|smoke|logs|status|outage");
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
