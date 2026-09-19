/**
 * Deliver `flows/` to Kestra. Runs once per deploy, as the `kestra-flows` one-shot service.
 *
 *   bun run scripts/kestraFlows.ts
 *
 * A flow that lives only in this repository schedules nothing. Dokploy raw compose has no
 * checkout to mount, and Kestra reads flows from its own database, not from a directory --
 * so for as long as nothing pushed them, `flows/ingest_daily.yml` was documentation and
 * every "scheduled" run was a run somebody started by hand. This closes that: the flows are
 * baked into the control-plane image, and this script PUTs each one through Kestra's API,
 * creating it when it does not exist yet, then exits.
 *
 * Two things here are deliberate rather than cautious:
 *
 *   - It WAITS for Kestra rather than failing on the first refused connection. Kestra is a
 *     Java standalone that takes a minute to answer, and this service starts alongside it.
 *     A flow Kestra rejects (a 4xx with a message) is a different matter and fails at once:
 *     retrying a broken flow produces the same rejection, later, with less context.
 *   - The API path carries the tenant. Kestra 1.0 put `/{tenant}/` into every path, `main`
 *     being the tenant an OSS install has; an older Kestra answers 404 to that shape, so the
 *     un-prefixed path is tried once before giving up. A 404 on CREATE cannot mean "no such
 *     flow", which is what makes it safe to read as "no such path".
 *
 * Nothing about a flow is secret. `{{ envs.trigger_token }}` is a template Kestra resolves
 * at run time from its own environment; the token never passes through here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_DEADLINE_MS = 300_000;
const DEFAULT_RETRY_MS = 5000;
const NOT_FOUND = 404;
const SERVER_ERROR = 500;

/** The two shapes Kestra's flow API has had: with the tenant in the path, and without. */
const FLOW_PATHS = ["/api/v1/main/flows", "/api/v1/flows"] as const;

const ID_LINE = /^id:\s*([A-Za-z0-9_-]+)\s*$/mu;
const NAMESPACE_LINE = /^namespace:\s*([A-Za-z0-9_.-]+)\s*$/mu;
const TRAILING_SLASHES = /\/+$/u;

export interface Config {
  readonly baseUrl: string;
  readonly user: string;
  readonly password: string;
  readonly deadlineMs: number;
  readonly retryMs: number;
}

/** Narrower than `typeof fetch` for the reason `scripts/dokploy.ts` gives. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Deps {
  readonly fetch: Fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly now: () => number;
}

export interface FlowFile {
  readonly file: string;
  readonly yaml: string;
}

export interface Delivery {
  readonly created: string[];
  readonly updated: string[];
}

/** Kestra answered and said no. Retrying produces the same answer. */
export class FlowRejected extends Error {
  constructor(
    readonly file: string,
    readonly status: number,
    body: string,
  ) {
    super(`${file}: Kestra refused the flow (${status}): ${body}`);
    this.name = "FlowRejected";
  }
}

/** Kestra is not answering, or answered with a fault of its own. Worth waiting for. */
export class KestraUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KestraUnavailable";
  }
}

export function configFromEnv(env: Record<string, string | undefined>): Config {
  const user = env.UNDERCROFT_KESTRA_USER ?? "";
  const password = env.UNDERCROFT_KESTRA_PASSWORD ?? "";
  if (user === "" || password === "") {
    throw new Error("UNDERCROFT_KESTRA_USER and UNDERCROFT_KESTRA_PASSWORD are required");
  }
  return {
    baseUrl: (env.UNDERCROFT_KESTRA_URL ?? "http://undercroft-kestra:8080").replace(
      TRAILING_SLASHES,
      "",
    ),
    user,
    password,
    deadlineMs: DEFAULT_DEADLINE_MS,
    retryMs: DEFAULT_RETRY_MS,
  };
}

/** Every `*.yml` in the directory, in name order, so the log reads the same each deploy. */
export function readFlowsDir(dir: string): FlowFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((file) => ({ file, yaml: readFileSync(join(dir, file), "utf8") }));
}

/**
 * The flow's own name for itself, read off the two top-level lines Kestra requires.
 *
 * A regex rather than a YAML parser on purpose: the two keys are top-level scalars, and
 * the only thing a parser would add is a way for a flow with a mis-indented `id` to be
 * read as having none.
 */
export function identify(flow: FlowFile): { id: string; namespace: string } {
  const id = ID_LINE.exec(flow.yaml)?.[1];
  const namespace = NAMESPACE_LINE.exec(flow.yaml)?.[1];
  if (id === undefined || namespace === undefined) {
    throw new Error(`${flow.file}: a flow needs top-level \`id:\` and \`namespace:\` lines`);
  }
  return { id, namespace };
}

type Attempt = "created" | "updated" | "no-such-path";

interface Send {
  readonly method: "PUT" | "POST";
  readonly url: string;
  readonly yaml: string;
}

async function send(cfg: Config, deps: Deps, request: Send): Promise<Response> {
  try {
    return await deps.fetch(request.url, {
      method: request.method,
      headers: {
        authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
        "content-type": "application/x-yaml",
      },
      body: request.yaml,
    });
  } catch (error) {
    throw new KestraUnavailable(
      `${request.method} ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function attempt(cfg: Config, deps: Deps, flow: FlowFile, path: string): Promise<Attempt> {
  const { id, namespace } = identify(flow);
  const put = await send(cfg, deps, {
    method: "PUT",
    url: `${cfg.baseUrl}${path}/${namespace}/${id}`,
    yaml: flow.yaml,
  });
  if (put.ok) {
    return "updated";
  }
  if (put.status !== NOT_FOUND) {
    throw await refusalOrOutage(flow, put);
  }
  const post = await send(cfg, deps, {
    method: "POST",
    url: `${cfg.baseUrl}${path}`,
    yaml: flow.yaml,
  });
  if (post.ok) {
    return "created";
  }
  if (post.status === NOT_FOUND) {
    return "no-such-path";
  }
  throw await refusalOrOutage(flow, post);
}

async function refusalOrOutage(flow: FlowFile, response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  if (response.status >= SERVER_ERROR) {
    return new KestraUnavailable(`${flow.file}: Kestra answered ${response.status}: ${body}`);
  }
  return new FlowRejected(flow.file, response.status, body);
}

async function deliverOne(cfg: Config, deps: Deps, flow: FlowFile): Promise<"created" | "updated"> {
  for (const path of FLOW_PATHS) {
    const outcome = await attempt(cfg, deps, flow, path);
    if (outcome !== "no-such-path") {
      return outcome;
    }
  }
  throw new FlowRejected(flow.file, NOT_FOUND, "no flows path answered; is this Kestra?");
}

/**
 * Push every flow, waiting for Kestra to answer and refusing to wait for a flow it rejected.
 */
export async function deliverFlows(
  cfg: Config,
  deps: Deps,
  flows: readonly FlowFile[],
): Promise<Delivery> {
  const created: string[] = [];
  const updated: string[] = [];
  const deadline = deps.now() + cfg.deadlineMs;

  for (const flow of flows) {
    for (;;) {
      try {
        const outcome = await deliverOne(cfg, deps, flow);
        (outcome === "created" ? created : updated).push(flow.file);
        deps.log(`${flow.file}: ${outcome}`);
        break;
      } catch (error) {
        if (!(error instanceof KestraUnavailable) || deps.now() >= deadline) {
          throw error;
        }
        deps.log(`${error.message}; waiting for Kestra`);
        await deps.sleep(cfg.retryMs);
      }
    }
  }
  return { created, updated };
}

if (import.meta.main) {
  const deps: Deps = {
    fetch: (input: string, init?: RequestInit): Promise<Response> => fetch(input, init),
    sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line: string): void => {
      process.stdout.write(`${line}\n`);
    },
    now: (): number => Date.now(),
  };
  deliverFlows(
    configFromEnv(process.env),
    deps,
    readFlowsDir(process.env.UNDERCROFT_FLOWS_DIR ?? "flows"),
  ).then(
    (delivery) => {
      deps.log(
        `delivered ${delivery.created.length + delivery.updated.length} flow(s): ${delivery.created.length} created, ${delivery.updated.length} updated`,
      );
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
