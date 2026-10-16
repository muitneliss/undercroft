/**
 * The CLI, as its users run it: the built bundle, spawned under `node`, against the real
 * control plane.
 *
 * The public seam of a CLI is its process -- argv in; stdout, stderr and an exit code out --
 * so that is what every test here drives. `beforeAll` builds the bundle into a temporary
 * directory with the same `buildCli` the release uses, so nothing is written into the repo and
 * the bundle under test is the bundle that ships, `virtual:surface` and all. Each test gets
 * a fresh `startControlPlane()` -- real Better Auth, real tRPC, PGlite, the in-memory mailbox
 * and worker -- and its own `UNDERCROFT_CLI_HOME`, so no test can see another's session.
 *
 * Nothing is mocked. The one-time code is read out of the email the server really sent.
 * What is NOT tested here, deliberately: the router's own zod rules (the server's suites own
 * them), Clack's rendering and the home page's (a real TTY, checked by hand), argv permutations, and i18n key
 * parity (`en: typeof vi` in `i18n/index.ts` is a compile error when one is missing).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test as it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { byCodeUnit } from "@undercroft/core";
import { appRouter } from "@undercroft/control-plane/router";
import { type ControlPlane, startControlPlane } from "@undercroft/control-plane/testing";
import { buildCli } from "../scripts/build.ts";

const OPERATOR = "operator@example.test";
/** The operator's own tenant, and one that exists but is not theirs. */
const OWN = "CASE-0042";
const OTHER = "CASE-0099";

interface Envelope {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly meta?: { readonly count: number };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
    readonly details?: unknown;
    readonly traceId?: string;
  };
}

interface Ran {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

let buildDir = "";
let bundle = "";
let plane: ControlPlane;
let home = "";
let work = "";

beforeAll(async () => {
  buildDir = mkdtempSync(join(tmpdir(), "undercroft-cli-build-"));
  bundle = await buildCli(buildDir);
});

beforeEach(async () => {
  plane = await startControlPlane({
    seed: async (db) => {
      await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [OWN, OTHER]);
      await db.query(
        `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
         VALUES ($1, $2, 'admin', repeat('a', 64), now() + interval '7 days')`,
        [OWN, OPERATOR],
      );
    },
  });
  home = mkdtempSync(join(tmpdir(), "undercroft-cli-home-"));
  // The working directory too, so no `undercroft.cli.json` above the repo can pin a profile.
  work = mkdtempSync(join(tmpdir(), "undercroft-cli-work-"));
});

afterEach(async () => {
  await plane.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(buildDir, { recursive: true, force: true });
});

/**
 * Run the bundle. The environment is built from nothing: no `UNDERCROFT_URL` or
 * `UNDERCROFT_PROFILE` from the developer's shell can leak into what a test asserts. `env` adds
 * what one run is given, as a CI job's secret variable would be.
 */
async function undercroft(
  args: readonly string[],
  options: { keepStdinOpen?: boolean; env?: Readonly<Record<string, string>> } = {},
): Promise<Ran> {
  const child = Bun.spawn(["node", bundle, ...args], {
    cwd: work,
    env: {
      ...options.env,
      // biome-ignore lint/style/noProcessEnv: PATH is the one value taken from the suite's own environment, so `node` can be found; everything else the CLI reads is set here.
      PATH: process.env.PATH ?? "",
      HOME: work,
      UNDERCROFT_CLI_HOME: home,
    },
    stdin: options.keepStdinOpen === true ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function envelope(ran: Ran): Envelope {
  return JSON.parse(ran.stdout) as Envelope;
}

/** A profile, written the way a person's own `config set-profile` at a terminal leaves it. */
function writeProfile(name: string, url: string, allowWrites: boolean): void {
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ defaultProfile: name, profiles: { [name]: { url, allowWrites } } }),
  );
}

/** Sign in as the operator through both steps of the CLI's login, with the emailed code. */
async function signIn(): Promise<void> {
  const asked = await undercroft(["auth", "login", "--email", OPERATOR, "--agent"]);
  expect(envelope(asked).ok).toBe(true);
  const code = /\d{6}/u.exec(plane.sender.last?.text ?? "")?.[0] ?? "no-code-was-sent";
  const signed = await undercroft([
    "auth",
    "login",
    "--email",
    OPERATOR,
    "--code",
    code,
    "--agent",
  ]);
  expect(envelope(signed).ok).toBe(true);
}

/** The other spelling of the same loopback server: `localhost` <-> `127.0.0.1`. */
function otherHost(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
  return url.origin;
}

describe("an agent reads the platform through the same door as the browser", () => {
  it("signing in with the emailed code and listing runs answers with nothing but JSON", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();

    // No `--agent`: a piped stdout is what makes this agent mode, which is the case an
    // agent's harness is actually in.
    const listed = await undercroft(["runs", "list", "--tenant-id", OWN]);

    expect(listed.exitCode).toBe(0);
    expect(listed.stderr).toBe("");
    expect(listed.stdout).not.toContain("\u001b[");
    expect(envelope(listed)).toEqual({ ok: true, data: { items: [], nextCursor: null } });
    // The permission bits, read as the octal a person would type into chmod.
    expect(statSync(join(home, "credentials.json")).mode.toString(8).slice(-3)).toBe("600");
  });

  it("offers one command for every procedure the router has, and no other", async () => {
    // The user's requirement, as a gate: a procedure added to the router without a CLI
    // command -- or a command whose procedure was removed -- fails the build here.
    const described = envelope(await undercroft(["describe", "--agent"]));
    const entries = (described.data ?? []) as readonly { readonly procedure: string | null }[];

    expect(entries.flatMap((entry) => entry.procedure ?? []).sort(byCodeUnit)).toEqual(
      Object.keys(appRouter._def.procedures).sort(byCodeUnit),
    );
  });

  it("a bare run outside a terminal is still the help, never the page a person is shown", async () => {
    // `undercroft` on its own draws the home page only for a person at a terminal. A piped
    // run -- an agent's -- must answer exactly as `--help` does, or the contract moved under it.
    writeProfile("local", plane.origin, false);

    const bare = await undercroft([]);

    expect(bare.exitCode).toBe(0);
    expect(bare.stdout).toBe((await undercroft(["--help"])).stdout);
  });

  it("a browse the grant cannot serve says in error.details what could not be listed, and the fix", async () => {
    // Issue 177. The refusal arrived as a sentence and nothing else, so an agent could not
    // tell "this source has no list" from "reconnect it" without parsing Vietnamese prose.
    writeProfile("local", plane.origin, false);
    await signIn();
    plane.worker.failing("scope-insufficient");

    const refused = await undercroft([
      "connections",
      "browse-scope",
      "--tenant-id",
      OWN,
      "--source",
      "drive",
      "--agent",
    ]);

    expect(envelope(refused).error).toMatchObject({
      code: "CONFLICT",
      details: {
        source: "drive",
        listing: "folders",
        reason: "scope-insufficient",
        remedy: "reconnect",
      },
    });
  });

  it("a browse names its parent and its page as typed flags, though the parent may also be null", async () => {
    // Issue 443. `parentId` is a nullable input, which the manifest describes as an `anyOf`;
    // read as anything but its string, it had no flag, and the one level an agent asks for
    // could only be sent as JSON.
    writeProfile("local", plane.origin, false);
    await signIn();
    plane.worker.withChoices({
      items: [
        { id: "f-a", name: "Accounts", kind: "folder", path: ["Accounts"], parentId: null },
        { id: "f-1", name: "2025", kind: "folder", path: ["Accounts", "2025"], parentId: "f-a" },
        { id: "f-2", name: "2026", kind: "folder", path: ["Accounts", "2026"], parentId: "f-a" },
      ],
      partial: [],
    });

    const level = await undercroft([
      "connections",
      "browse-scope",
      "--tenant-id",
      OWN,
      "--source",
      "drive",
      "--parent-id",
      "f-a",
      "--limit",
      "1",
      "--agent",
    ]);

    expect(envelope(level).data).toMatchObject({
      items: [{ id: "f-1" }],
      nextCursor: expect.any(String),
    });
  });

  it("a tenant that is not yours is NOT_FOUND, never an empty list", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();

    const refused = await undercroft(["runs", "list", "--tenant-id", OTHER, "--agent"]);

    expect(refused.exitCode).toBe(3);
    expect(envelope(refused).error?.code).toBe("NOT_FOUND");
  });

  it("a refusal names the server's trace id, the handle a bug report quotes", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();

    const refused = await undercroft(["runs", "list", "--tenant-id", OTHER, "--agent"]);

    expect(envelope(refused).error?.traceId).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("a missing argument fails at once, even with stdin left open", async () => {
    const started = Date.now();
    const refused = await undercroft(["runs", "list", "--agent"], { keepStdinOpen: true });

    expect(refused.exitCode).toBe(2);
    expect(envelope(refused).error?.code).toBe("MISSING_REQUIRED_ARGUMENT");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("environments stay apart", () => {
  it("a session from one origin is never sent to another", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();

    // The same process on the same port, under its other name.
    const refused = await undercroft([
      "runs",
      "list",
      "--tenant-id",
      OWN,
      "--url",
      otherHost(plane.origin),
      "--agent",
    ]);

    expect(refused.exitCode).toBe(5);
    expect(envelope(refused).error?.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("with no profile and no URL there is no server to guess", async () => {
    const refused = await undercroft(["tenants", "list", "--agent"]);

    expect(refused.exitCode).toBe(2);
    expect(envelope(refused).error?.code).toBe("CONFIG_REQUIRED");
  });
});

describe("a write needs a person's permission, per environment", () => {
  it("a profile that does not allow writes refuses one before it reaches the server", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();

    const refused = await undercroft([
      "runs",
      "trigger",
      "--tenant-id",
      OWN,
      "--source",
      "hubspot",
      "--agent",
    ]);

    expect(refused.exitCode).toBe(6);
    expect(envelope(refused).error?.code).toBe("WRITES_DISABLED");
    expect(plane.worker.triggered).toHaveLength(0);
  });

  it("a profile a person allowed writes on starts the run", async () => {
    writeProfile("local", plane.origin, true);
    await signIn();

    const started = await undercroft([
      "runs",
      "trigger",
      "--tenant-id",
      OWN,
      "--source",
      "hubspot",
      "--agent",
    ]);

    expect(started.exitCode).toBe(0);
    expect(envelope(started).data).toEqual({ runId: "run-mem-1" });
    expect(plane.worker.triggered).toEqual([
      { source: "hubspot", tenantId: OWN, triggeredBy: expect.any(String) },
    ]);
  });

  it("what a person does and reads through the CLI is in their own log as the CLI's (ADR 0113, ADR 0120)", async () => {
    writeProfile("local", plane.origin, true);
    await signIn();
    await undercroft(["runs", "trigger", "--tenant-id", OWN, "--source", "hubspot", "--agent"]);
    await undercroft(["tenants", "get", "--tenant-id", OWN, "--agent"]);

    // A read of the log is a read too, so its own row lands after the page it answered with.
    const read = await undercroft(["audit", "mine", "--agent"]);

    const { items: entries } = envelope(read).data as {
      items: {
        action: string;
        channel: string | null;
        outcome: string;
        tenantId: string | null;
      }[];
    };
    expect(
      entries.map(({ action, channel, outcome, tenantId }) => [action, channel, outcome, tenantId]),
    ).toEqual([
      ["tenants.get", "cli", "ok", OWN],
      ["runs.trigger", "cli", "ok", OWN],
      ["auth.signIn", "cli", "ok", null],
      ["auth.invitationRedeemed", null, "ok", OWN],
    ]);
  });

  it("agent mode cannot grant itself writes, and the config is left as it was", async () => {
    writeProfile("local", plane.origin, false);
    const before = readFileSync(join(home, "config.json"), "utf8");

    const refused = await undercroft([
      "config",
      "set-profile",
      "local",
      "--allow-writes",
      "--agent",
    ]);

    expect(refused.exitCode).toBe(6);
    expect(envelope(refused).error?.code).toBe("HUMAN_REQUIRED");
    expect(readFileSync(join(home, "config.json"), "utf8")).toBe(before);
  });

  it("agent mode may add a read-only profile, but not point a writable one at another server", async () => {
    // The quiet half first: a profile that cannot write is an agent's to create.
    const added = await undercroft([
      "config",
      "set-profile",
      "staging",
      "--url",
      "https://staging.example.test",
      "--agent",
    ]);
    expect(envelope(added)).toEqual({
      ok: true,
      data: {
        profile: "staging",
        url: "https://staging.example.test",
        allowWrites: false,
        default: true,
      },
    });

    // Moving the grant a person gave one server onto another is granting it again.
    writeProfile("local", plane.origin, true);
    const moved = await undercroft([
      "config",
      "set-profile",
      "local",
      "--url",
      "https://elsewhere.example.test",
      "--agent",
    ]);

    expect(moved.exitCode).toBe(6);
    expect(envelope(moved).error?.code).toBe("HUMAN_REQUIRED");
  });

  it("a destructive command needs --yes, and the key stays live until it has one", async () => {
    writeProfile("local", plane.origin, true);
    await signIn();
    const minted = envelope(
      await undercroft(["keys", "mint", "--tenant-id", OWN, "--label", "nightly", "--agent"]),
    );
    const { id } = minted.data as { readonly id: string };
    async function revokedAt(): Promise<unknown> {
      const listed = envelope(await undercroft(["keys", "list", "--tenant-id", OWN, "--agent"]));
      return (listed.data as readonly { readonly id: string; readonly revokedAt: unknown }[]).find(
        (key) => key.id === id,
      )?.revokedAt;
    }

    const unconfirmed = await undercroft([
      "keys",
      "revoke",
      "--tenant-id",
      OWN,
      "--id",
      id,
      "--agent",
    ]);
    expect(unconfirmed.exitCode).toBe(2);
    expect(envelope(unconfirmed).error?.code).toBe("CONFIRMATION_REQUIRED");
    expect(await revokedAt()).toBeNull();

    const confirmed = await undercroft([
      "keys",
      "revoke",
      "--tenant-id",
      OWN,
      "--id",
      id,
      "--yes",
      "--agent",
    ]);
    expect(confirmed.exitCode).toBe(0);
    expect(await revokedAt()).toEqual(expect.any(String));
  });

  it("a dry run reaches nothing", async () => {
    writeProfile("local", plane.origin, true);
    await signIn();

    const rehearsed = await undercroft([
      "runs",
      "trigger",
      "--tenant-id",
      OWN,
      "--source",
      "hubspot",
      "--dry-run",
      "--agent",
    ]);

    expect(envelope(rehearsed)).toEqual({
      ok: true,
      data: {
        dryRun: true,
        operation: "runs.trigger",
        input: { tenantId: OWN, source: "hubspot" },
      },
    });
    expect(plane.worker.triggered).toHaveLength(0);
  });
});

describe("a desktop install signs its owner in on this machine (ADR 0096)", () => {
  const OWNER = "owner@example.test";

  beforeEach(async () => {
    // What the installer writes (ADR 0094): one address as the local method AND a superadmin,
    // no mail key, and nothing seeded -- a fresh install has no customer yet.
    await plane.stop();
    plane = await startControlPlane({
      devSignInAs: OWNER,
      superadmins: new Set([OWNER]),
      email: false,
    });
  });

  it("`auth login` with no address signs in, and the session reaches a superadmin-only call", async () => {
    // Written as the owner's own `config set-profile ... --allow-writes` at a terminal leaves
    // it: signing in grants nothing, so creating a customer needs the profile to allow it.
    writeProfile("local", plane.origin, true);

    const signed = await undercroft(["auth", "login", "--agent"]);
    expect(envelope(signed)).toEqual({
      ok: true,
      data: { origin: plane.origin, email: OWNER, signedIn: true },
    });

    // `tenants.create` is the router's one superadmin-only procedure, and the first thing a
    // fresh install's owner must do.
    const created = await undercroft([
      "tenants",
      "create",
      "--tenant-id",
      "CASE-0001",
      "--display-name",
      "First",
      "--agent",
    ]);
    expect(envelope(created)).toMatchObject({ ok: true, data: { id: "CASE-0001" } });
  });

  it("`--local` against a server not on this machine is refused before any request", async () => {
    const refused = await undercroft([
      "auth",
      "login",
      "--local",
      "--url",
      "https://undercroft.example.test",
      "--agent",
    ]);

    expect(refused.exitCode).toBe(2);
    expect(envelope(refused).error?.code).toBe("INVALID_ARGUMENT");
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  });
});

describe("an export is saved to a file (ADR 0111)", () => {
  /** Ask for an export of a definition, as an agent does; the link it was answered with. */
  async function exportLink(): Promise<string> {
    const created = await undercroft([
      "bi",
      "exports",
      "create",
      "--tenant-id",
      OWN,
      "--input-json",
      JSON.stringify({
        source: { kind: "definition", definition: { kind: "sql", sql: "select 1" } },
      }),
      "--agent",
    ]);
    const data = envelope(created).data as { url?: unknown } | undefined;
    return typeof data?.url === "string" ? data.url : "no link was answered";
  }

  it("with the person's own session, written whole to the file named", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();
    plane.worker.answering({
      columns: [{ name: "amount", type: "numeric" }],
      rows: [["-1234.5670"], [null]],
      truncated: false,
    });

    const saved = await undercroft([
      "bi",
      "exports",
      "download",
      await exportLink(),
      "--out",
      "rows.csv",
      "--agent",
    ]);

    expect(saved.exitCode).toBe(0);
    expect(readFileSync(join(work, "rows.csv"), "utf8")).toBe("﻿amount\r\n-1234.5670\r\n\r\n");
  });

  it("refuses a link to another server before the session is sent anywhere", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();
    const elsewhere = new URL(await exportLink(), otherHost(plane.origin)).toString();

    const refused = await undercroft([
      "bi",
      "exports",
      "download",
      elsewhere,
      "--out",
      "rows.csv",
      "--agent",
    ]);

    expect(envelope(refused).error?.code).toBe("INVALID_ARGUMENT");
    expect(plane.worker.exports).toEqual([]);
    expect(existsSync(join(work, "rows.csv"))).toBe(false);
  });
});

describe("signing out", () => {
  it("revokes the session on the server, so the old cookie is refused", async () => {
    writeProfile("local", plane.origin, false);
    await signIn();
    const stored = JSON.parse(readFileSync(join(home, "credentials.json"), "utf8")) as Record<
      string,
      { readonly cookie: string }
    >;
    const cookie = stored[plane.origin]?.cookie ?? "no-session-was-stored";

    const out = await undercroft(["auth", "logout", "--agent"]);
    expect(envelope(out).ok).toBe(true);

    const replayed = await Bun.fetch(`${plane.origin}/trpc/session.me`, { headers: { cookie } });
    const body = (await replayed.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("UNAUTHORIZED");
    expect(Object.keys(JSON.parse(readFileSync(join(home, "credentials.json"), "utf8")))).toEqual(
      [],
    );
  });
});

describe("an unattended sign-in with a personal access token (ADR 0134)", () => {
  /** The variable a CI job would hold the token in. */
  const VARIABLE = "UC_TOKEN";

  /** A browser session for the operator, through the emailed code as the web page signs in. */
  async function browserSession(): Promise<string> {
    function post(path: string, body: unknown): Promise<Response> {
      return Bun.fetch(`${plane.origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: plane.origin },
        body: JSON.stringify(body),
      });
    }
    await post("/api/auth/email-otp/send-verification-otp", { email: OPERATOR, type: "sign-in" });
    const otp = /\d{6}/u.exec(plane.sender.last?.text ?? "")?.[0];
    const signedIn = await post("/api/auth/sign-in/email-otp", { email: OPERATOR, otp });
    return signedIn.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");
  }

  /** A token minted on the account page, in the person's own browser session. */
  async function mint(grant: "read" | "write"): Promise<{ token: string; cookie: string }> {
    const cookie = await browserSession();
    const minted = await Bun.fetch(`${plane.origin}/trpc/account.tokens.mint`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ label: "nightly", grant, expiresInDays: 30 }),
    });
    const body = (await minted.json()) as { result: { data: { token: string } } };
    return { token: body.result.data.token, cookie };
  }

  async function logIn(token: string): Promise<Ran> {
    return await undercroft(["auth", "login", "--token-env", VARIABLE, "--agent"], {
      env: { [VARIABLE]: token },
    });
  }

  function trigger(token: string): Promise<Ran> {
    return undercroft(
      ["runs", "trigger", "--tenant-id", OWN, "--source", "hubspot", "--lang", "en", "--agent"],
      { env: { [VARIABLE]: token } },
    );
  }

  it("signs in and reads with the token alone, which no output and no file ever holds", async () => {
    writeProfile("local", plane.origin, false);
    const { token } = await mint("read");
    const env = { [VARIABLE]: token };

    const ran = [
      // The token itself where its variable's name belongs: refused, and not repeated back.
      await undercroft(["auth", "login", "--token-env", token, "--agent"], { env }),
      await logIn(token),
      await undercroft(["runs", "list", "--tenant-id", OWN, "--agent", "--verbose"], { env }),
      await undercroft(["auth", "status", "--agent"], { env }),
      await undercroft(["config", "show", "--agent"], { env }),
    ];

    expect(ran.map((run) => envelope(run).error?.code ?? "ok")).toEqual([
      "INVALID_ARGUMENT",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(envelope(ran[2] as Ran).data).toEqual({ items: [], nextCursor: null });
    expect(envelope(ran[3] as Ran).data).toMatchObject({
      email: OPERATOR,
      signedInWith: "token",
      tokenEnv: VARIABLE,
    });
    // What is kept is the variable's name and whose it is: no cookie, and no token.
    expect(JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"))).toEqual({
      [plane.origin]: { email: OPERATOR, tokenEnv: VARIABLE },
    });
    const secret = token.slice(token.indexOf(".") + 1);
    const everything = [
      ...ran.flatMap((run) => [run.stdout, run.stderr]),
      readFileSync(join(home, "credentials.json"), "utf8"),
      readFileSync(join(home, "config.json"), "utf8"),
    ].join("\n");
    expect(everything).not.toContain(secret);
  });

  it("a read token's write is refused by the server, naming the grant it needs", async () => {
    // The profile allows writes, so what refuses is the token's own grant.
    writeProfile("local", plane.origin, true);
    const { token } = await mint("read");
    await logIn(token);

    const refused = await trigger(token);

    expect(refused.exitCode).toBe(6);
    expect(envelope(refused).error).toMatchObject({
      code: "PERMISSION_DENIED",
      message: expect.stringContaining(VARIABLE),
      details: { reason: "WRITES_DISABLED", grant: "read", needs: "write" },
    });
    expect(plane.worker.triggered).toHaveLength(0);
  });

  it("a write token still writes only where a person allowed writes on the profile", async () => {
    writeProfile("local", plane.origin, false);
    const { token } = await mint("write");
    await logIn(token);

    const refused = await trigger(token);
    writeProfile("local", plane.origin, true);
    const started = await trigger(token);

    expect(envelope(refused).error?.code).toBe("WRITES_DISABLED");
    expect(envelope(started)).toEqual({ ok: true, data: { runId: "run-mem-1" } });
    expect(plane.worker.triggered).toHaveLength(1);
  });

  it("names the variable when it is unset, and says to mint a new token once it is revoked", async () => {
    writeProfile("local", plane.origin, false);
    const { token, cookie } = await mint("read");
    await logIn(token);
    const list = ["runs", "list", "--tenant-id", OWN, "--lang", "en", "--agent"];

    const unset = await undercroft(list);
    await Bun.fetch(`${plane.origin}/trpc/account.tokens.revoke`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: token.slice(0, token.indexOf(".")) }),
    });
    const revoked = await undercroft(list, { env: { [VARIABLE]: token } });

    expect([unset.exitCode, revoked.exitCode]).toEqual([5, 5]);
    expect(envelope(unset).error).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: expect.stringContaining(`${VARIABLE}, but that variable is unset`),
    });
    expect(envelope(revoked).error).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: expect.stringContaining(`refused the token in ${VARIABLE}`),
    });
  });
});
