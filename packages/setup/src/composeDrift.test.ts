/**
 * The install compose file is the server's with the Dokploy host taken out
 * (`deploy/compose/docker-compose.install.yml` says what else differs, and why). These pin the
 * two together, so a service or an image added to the server file and not to the install one
 * fails here, rather than on somebody's laptop the day that release installs.
 */

import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Answers } from "./answers.ts";
import { COMPOSE_FILE, PROJECT } from "./composeFile.ts";
import { parseEnv } from "./envFile.ts";
import { installation } from "./installation.ts";
import { steppingClock, tableRunner } from "./testing.ts";

const SERVER_FILE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "deploy",
  "compose",
  "docker-compose.server.yml",
);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "undercroft-drift-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface ComposeService {
  readonly image?: string;
  readonly ports?: readonly string[];
  readonly networks?: Readonly<Record<string, unknown>>;
}

interface ComposeFile {
  readonly name: string;
  readonly services: Readonly<Record<string, ComposeService>>;
  readonly networks?: Readonly<Record<string, unknown>>;
}

const install = Bun.YAML.parse(COMPOSE_FILE) as ComposeFile;
const server = Bun.YAML.parse(await readFile(SERVER_FILE, "utf8")) as ComposeFile;

/** The release pointer is required in one file and defaults to `latest` in the other. */
function image(service: ComposeService | undefined): string {
  return (service?.image ?? "").replace(/\$\{IMAGE_TAG[^}]*\}/u, "<release>");
}

it("runs exactly the server's services, each from the server's image", () => {
  expect(Object.keys(install.services).sort()).toEqual(Object.keys(server.services).sort());
  for (const name of Object.keys(server.services)) {
    expect(`${name}: ${image(install.services[name])}`).toBe(
      `${name}: ${image(server.services[name])}`,
    );
  }
});

it("publishes the control plane alone, on the bind address, and joins no outside network", () => {
  const published = Object.entries(install.services).filter(
    ([, service]) => service.ports !== undefined,
  );
  expect(published.map(([name, service]) => [name, service.ports])).toEqual([
    [
      "control-plane",
      [
        expect.stringMatching(
          /^\$\{UNDERCROFT_BIND:-127\.0\.0\.1\}:\$\{UNDERCROFT_PORT_API:-13000\}:3000$/u,
        ),
      ],
    ],
  ]);
  expect(install.networks).toBeUndefined();
  for (const service of Object.values(install.services)) {
    expect(Object.keys(service.networks ?? {}).filter((network) => network !== "default")).toEqual(
      [],
    );
  }
});

it("is the project whose volumes the installer looks for", () => {
  expect(install.name).toBe(PROJECT);
});

const REQUIRED = [...COMPOSE_FILE.matchAll(/\$\{(?<name>[A-Z_][A-Z0-9_]*):\?/gu)].map(
  (match) => match.groups?.name ?? "",
);

it.each<[string, Answers]>([
  [
    "desktop",
    {
      mode: "desktop",
      port: 13_000,
      imageTag: "v1.55.0",
      connectors: { googleIngest: null, xero: null },
    },
  ],
  [
    "server",
    {
      mode: "server",
      port: 13_000,
      imageTag: "v1.55.0",
      bind: "0.0.0.0",
      publicUrl: "https://data.example.test",
      adminEmail: "ada@example.test",
      signIn: { kind: "email", apiKey: "re_example", from: "no-reply@example.test" },
      connectors: { googleIngest: null, xero: null },
    },
  ],
])("a %s install writes every variable the compose file requires", async (_, answers) => {
  const result = await installation({
    dir,
    run: tableRunner({ "docker volume inspect undercroft-install_postgres-data": { code: 1 } }),
    fetch: () => Promise.reject(new Error("unused")),
    clock: steppingClock(),
  }).write(answers);
  expect(result.ok).toBe(true);

  const env = parseEnv(await readFile(join(dir, ".env"), "utf8"));
  expect(REQUIRED.length).toBeGreaterThan(0);
  expect(REQUIRED.filter((name) => (env.get(name) ?? "") === "")).toEqual([]);
});
