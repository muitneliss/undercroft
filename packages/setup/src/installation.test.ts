import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { appendFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Answers } from "./answers.ts";
import { DESKTOP_OWNER } from "./answers.ts";
import { parseEnv } from "./envFile.ts";
import { type Fetch, installation, type InstallationDeps } from "./installation.ts";
import { SECRET_NAMES } from "./secrets.ts";
import { steppingClock, tableRunner } from "./testing.ts";

const NO_CONNECTORS = { googleIngest: null, xero: null } as const;

const DESKTOP: Answers = {
  mode: "desktop",
  port: 13_000,
  imageTag: "v1.55.0",
  connectors: NO_CONNECTORS,
};

const SERVER: Answers = {
  mode: "server",
  port: 13_000,
  imageTag: "v1.55.0",
  bind: "127.0.0.1",
  publicUrl: "https://data.example.test",
  adminEmail: "Ada@Example.test",
  signIn: { kind: "google", clientId: "client.apps.example.test", clientSecret: "shh" },
  connectors: NO_CONNECTORS,
};

/** No earlier install's data on this machine. */
const CLEAN_MACHINE = tableRunner({
  "docker volume inspect undercroft-install_postgres-data": { code: 1, stderr: "no such volume" },
});

const unreachable: Fetch = () => Promise.reject(new Error("connection refused"));

let dir: string;

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), "undercroft-setup-")), "install");
});

afterEach(async () => {
  await rm(join(dir, ".."), { recursive: true, force: true });
});

function deps(overrides: Partial<InstallationDeps> = {}): InstallationDeps {
  return { dir, run: CLEAN_MACHINE, fetch: unreachable, clock: steppingClock(), ...overrides };
}

async function env(): Promise<Map<string, string>> {
  return parseEnv(await readFile(join(dir, ".env"), "utf8"));
}

describe("write", () => {
  it("signs a desktop install's owner in as its one superadmin, on loopback", async () => {
    const result = await installation(deps()).write(DESKTOP);

    expect(result).toEqual({ ok: true, url: "http://localhost:13000", firstInstall: true });
    const values = await env();
    expect(values.get("UNDERCROFT_DEV_SIGN_IN_AS")).toBe(DESKTOP_OWNER);
    expect(values.get("UNDERCROFT_SUPERADMINS")).toBe(DESKTOP_OWNER);
    expect(values.get("UNDERCROFT_PUBLIC_URL")).toBe("http://localhost:13000");
    expect(values.get("UNDERCROFT_BIND")).toBe("127.0.0.1");
  });

  it("never lets a server install sign anyone in without proof", async () => {
    await installation(deps()).write(SERVER);

    const values = await env();
    expect(values.get("UNDERCROFT_DEV_SIGN_IN_AS")).toBe("");
    expect(values.get("UNDERCROFT_SUPERADMINS")).toBe("ada@example.test");
    expect(values.get("UNDERCROFT_PUBLIC_URL")).toBe("https://data.example.test");
  });

  it.skipIf(process.platform === "win32")("writes .env readable by its owner alone", async () => {
    await installation(deps()).write(DESKTOP);

    expect((await stat(join(dir, ".env"))).mode.toString(8).slice(-3)).toBe("600");
  });

  it("keeps every secret and a line added by hand on a re-run, and changes what the answers changed", async () => {
    await installation(deps()).write(DESKTOP);
    const first = await env();
    await appendFile(join(dir, ".env"), "UNDERCROFT_ANTHROPIC_API_KEY='added-by-hand'\n");

    const again = await installation(deps()).write({ ...DESKTOP, port: 14_000 });

    expect(again).toEqual({ ok: true, url: "http://localhost:14000", firstInstall: false });
    const second = await env();
    for (const name of SECRET_NAMES) {
      expect(first.get(name)?.length ?? 0).toBeGreaterThan(0);
      expect(second.get(name)).toBe(first.get(name));
    }
    expect(second.get("UNDERCROFT_ANTHROPIC_API_KEY")).toBe("added-by-hand");
    expect(second.get("UNDERCROFT_PUBLIC_URL")).toBe("http://localhost:14000");
  });

  it("reads back the answers it wrote, which is what a re-run starts from", async () => {
    const install = installation(deps());
    await install.write(SERVER);

    expect(await install.read()).toEqual({ ...SERVER, adminEmail: "ada@example.test" });
  });

  it("refuses to invent secrets beside an earlier install's data, and writes nothing", async () => {
    const orphaned = tableRunner({
      "docker volume inspect undercroft-install_postgres-data": { stdout: "[{}]" },
    });

    const result = await installation(deps({ run: orphaned })).write(DESKTOP);

    expect(result).toEqual({
      ok: false,
      reason: "orphaned-data",
      volume: "undercroft-install_postgres-data",
    });
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("writes nothing for answers that cannot run", async () => {
    const result = await installation(deps()).write({
      ...SERVER,
      publicUrl: "http://data.example.test",
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      problems: [{ field: "publicUrl", code: "public-url-not-https" }],
    });
    expect(existsSync(dir)).toBe(false);
  });
});

describe("waitHealthy", () => {
  it("answers once the control plane's health endpoint does", async () => {
    let calls = 0;
    const warmingUp: Fetch = (url) => {
      calls += 1;
      expect(url).toBe("http://127.0.0.1:13000/api/health");
      return Promise.resolve(new Response("{}", { status: calls < 3 ? 502 : 200 }));
    };
    const install = installation(deps({ fetch: warmingUp }));
    await install.write(DESKTOP);

    expect(await install.waitHealthy(60_000)).toEqual({ ok: true });
  });

  it("gives up at its deadline and says what it last saw", async () => {
    const install = installation(deps());
    await install.write(DESKTOP);

    expect(await install.waitHealthy(60_000)).toEqual({
      ok: false,
      lastError: "connection refused",
    });
  });
});
