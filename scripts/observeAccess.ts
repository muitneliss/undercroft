/**
 * How `observe.ts` reaches what it reads, with nothing stored: every credential is looked
 * up when it is needed, from what this checkout already holds, and none is written anywhere
 * or printed.
 *
 *   - the Dokploy API key: DOKPLOY_API_ENDPOINT/DOKPLOY_API_KEY, as `scripts/dokploy.ts`
 *     reads them, else the gitignored `.dokploy.json` at the repo root;
 *   - Grafana: the domain on port 3000 and GF_ADMIN_USER/GF_ADMIN_PASSWORD of the Dokploy
 *     compose named `otel-lgtm` -- the stack is the host's, shared, and not this repo's
 *     (ADR 0058), so its credentials live in its own panel entry, not in ours;
 *   - SSH: the host's IP from Dokploy (`settings.getIp`), matched to a `Host` in
 *     `~/.ssh/config` by its `HostName`.
 *
 * What cannot be found is named and the command stops: a guessed host or a default password
 * would answer with somebody else's data or with nothing, and both read like "no trace".
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export const OBSERVABILITY_COMPOSE = "otel-lgtm";
const GRAFANA_PORT = 3000;
const USER_AGENT = "undercroft-observe/1.0";
const TRAILING_SLASH = /\/+$/u;
const WHITESPACE = /\s+/u;

export interface Dokploy {
  readonly endpoint: string;
  readonly apiKey: string;
}

export interface Grafana {
  readonly url: string;
  readonly authorization: string;
}

interface ComposeSummary {
  readonly name: string;
  readonly composeId: string;
}

export interface ComposeDetail {
  readonly appName: string;
  readonly env: string | null;
  readonly domains: readonly { readonly host: string; readonly port: number | null }[];
}

export function fail(message: string): never {
  throw new Error(message);
}

export function dokploy(): Dokploy {
  const endpoint = process.env.DOKPLOY_API_ENDPOINT ?? "";
  const apiKey = process.env.DOKPLOY_API_KEY ?? "";
  if (endpoint !== "" && apiKey !== "") {
    return { endpoint: endpoint.replace(TRAILING_SLASH, ""), apiKey };
  }
  const file = join(import.meta.dirname, "..", ".dokploy.json");
  if (!existsSync(file)) {
    return fail(
      "no Dokploy credentials: set DOKPLOY_API_ENDPOINT and DOKPLOY_API_KEY, or put .dokploy.json at the repo root",
    );
  }
  const saved = JSON.parse(readFileSync(file, "utf8")) as {
    api_endpoint?: string;
    api_key?: string;
  };
  if (!(saved.api_endpoint && saved.api_key)) {
    return fail(".dokploy.json has no api_endpoint or api_key");
  }
  return { endpoint: saved.api_endpoint.replace(TRAILING_SLASH, ""), apiKey: saved.api_key };
}

export async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT, ...headers },
  });
  if (!response.ok) {
    // The URL is not echoed whole: a Loki query can carry the id being looked for, which is
    // fine, but the host is the credential's audience and says nothing the status does not.
    return fail(`${new URL(url).pathname} -> HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function callDokploy<T>(api: Dokploy, path: string): Promise<T> {
  return getJson<T>(`${api.endpoint}/${path}`, { "x-api-key": api.apiKey });
}

export async function composeNamed(api: Dokploy, name: string): Promise<ComposeDetail> {
  const projects = await callDokploy<
    readonly {
      readonly environments?: readonly { readonly compose?: readonly ComposeSummary[] }[];
    }[]
  >(api, "project.all");
  const found = projects
    .flatMap((project) => project.environments ?? [])
    .flatMap((environment) => environment.compose ?? [])
    .find((compose) => compose.name === name);
  if (found === undefined) {
    return fail(`no Dokploy compose named "${name}"`);
  }
  return await callDokploy<ComposeDetail>(
    api,
    `compose.one?composeId=${encodeURIComponent(found.composeId)}`,
  );
}

function envValue(env: string | null, key: string): string {
  const line = (env ?? "").split("\n").find((entry) => entry.startsWith(`${key}=`));
  return line === undefined ? "" : line.slice(key.length + 1).trim();
}

export async function grafana(api: Dokploy): Promise<Grafana> {
  const stack = await composeNamed(api, OBSERVABILITY_COMPOSE);
  const domain = stack.domains.find((entry) => entry.port === GRAFANA_PORT);
  const user = envValue(stack.env, "GF_ADMIN_USER");
  const password = envValue(stack.env, "GF_ADMIN_PASSWORD");
  const missing = [
    domain === undefined ? `a domain on port ${GRAFANA_PORT}` : "",
    user === "" ? "GF_ADMIN_USER" : "",
    password === "" ? "GF_ADMIN_PASSWORD" : "",
  ].filter((name) => name !== "");
  if (domain === undefined || missing.length > 0) {
    return fail(`the ${OBSERVABILITY_COMPOSE} compose has no ${missing.join(", ")}`);
  }
  return {
    url: `https://${domain.host}`,
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
  };
}

/** The `Host` alias in ~/.ssh/config whose `HostName` is `ip`. */
function sshAliasFor(ip: string): string {
  const file = join(homedir(), ".ssh", "config");
  if (!existsSync(file)) {
    return fail(`no ~/.ssh/config, so no SSH host for ${ip}`);
  }
  let aliases: string[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const [keyword = "", ...rest] = raw.trim().split(WHITESPACE);
    const key = keyword.toLowerCase();
    if (key === "host") {
      aliases = rest.filter((alias) => !alias.includes("*"));
    } else if (key === "hostname" && rest[0] === ip && aliases.length > 0) {
      return aliases[0] ?? fail("unreachable");
    }
  }
  return fail(`no Host in ~/.ssh/config has HostName ${ip}; add one to reach the Dokploy host`);
}

export async function sshHost(api: Dokploy): Promise<string> {
  const ip = await callDokploy<string>(api, "settings.getIp");
  return sshAliasFor(ip);
}

export async function ssh(host: string, command: string): Promise<string> {
  const child = Bun.spawn(
    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    return fail(`ssh ${host} exited ${code}: ${stderr.trim().slice(0, 300)}`);
  }
  // `docker logs` writes the container's stderr to ours; both are the log.
  return `${stdout}${stderr}`;
}

export function datasource(g: Grafana, uid: string, path: string): Promise<unknown> {
  return getJson(`${g.url}/api/datasources/proxy/uid/${uid}${path}`, {
    authorization: g.authorization,
  });
}

// --- trace ------------------------------------------------------------------
