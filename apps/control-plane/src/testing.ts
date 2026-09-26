/**
 * The real control plane on a loopback socket, for a suite that has to reach it over HTTP.
 *
 * Taken from `handlers/gate.test.ts`, whose `beforeEach` proved the shape: `Bun.serve` on
 * port 0, a real `createAuth` on Better Auth's own `memoryAdapter`, `InMemoryEmailSender` for
 * the one-time codes, `InMemoryWorkerClient` for the worker, and PGlite for everything the
 * platform keeps in Postgres. Nothing is mocked; no Docker, no network, no credentials. That
 * suite still carries its own copy, and moving it here is a follow-up rather than part of the
 * change that introduced this.
 *
 * It exists for callers OUTSIDE this package -- `apps/cli`'s suite runs the built CLI as a
 * `node` process against it -- which is why it is an export (`@undercroft/control-plane/
 * testing`) and why it hides the one fact about this repo's test process that a caller would
 * otherwise have to know: `bunfig.toml` preloads happy-dom for every suite, and `Bun.serve`
 * refuses happy-dom's `Response`. So while the server runs, the globals happy-dom replaced are
 * Bun's own again -- see `liftDom` for why that is a swap and not `unregister()`.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { InMemoryEmailSender, type Logger } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import type { BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "./handlers/auth.ts";
import { createServer } from "./handlers/server.ts";
import { InMemoryWorkerClient } from "./services/inMemoryWorkerClient.ts";
import type { Skill } from "./handlers/mcpSkills.ts";
import { readSkills, SKILLS_ROOT } from "./skills.ts";
import { buildWidgets } from "./widgets.ts";

export interface ControlPlane {
  /** Where it listens, e.g. `http://localhost:54321`. Also Better Auth's one trusted origin. */
  readonly origin: string;
  /** Postgres-in-WASM, already migrated, and running as `undercroft_app` after `seed`. */
  readonly db: TestDatabase;
  /** Every email the server sent, one-time codes included. */
  readonly sender: InMemoryEmailSender;
  /** What the control plane asked the worker to do. */
  readonly worker: InMemoryWorkerClient;
  readonly stop: () => Promise<void>;
}

export interface ControlPlaneOptions {
  /** Fixtures, planted as the superuser before the database becomes `undercroft_app`. */
  readonly seed?: (db: TestDatabase) => Promise<void>;
  /** The skills `/mcp` serves. The repository's own by default; `[]` serves none. */
  readonly skills?: readonly Skill[];
  /** Addresses named in `UNDERCROFT_SUPERADMINS`. None by default. */
  readonly superadmins?: ReadonlySet<string>;
  /** `UNDERCROFT_DEV_SIGN_IN_AS`. Off by default, as it is on every deployment. */
  readonly devSignInAs?: string;
  /**
   * Where the server logs. None by default. A suite that asserts a line hands in a real
   * `createLogger` whose `sink` keeps the lines in memory.
   */
  readonly log?: Logger;
}

function isDescriptor(value: unknown): value is PropertyDescriptor {
  return typeof value === "object" && value !== null;
}

/**
 * Put back the globals happy-dom replaced, answering with what reinstates happy-dom's.
 *
 * A SWAP, not `GlobalRegistrator.unregister()` then `register()`, and the difference was
 * measured: the pair closes the window and builds a new document, while every module that
 * bound `document.body` when it was imported -- `@testing-library/dom`'s `screen` is one --
 * keeps querying the old one. Eight UI suites that ran after this harness in the same `bun
 * test` process then rendered into one body and searched another. Swapping keeps the one
 * window throughout, so nothing bound to it goes stale.
 *
 * The list of what to swap is happy-dom's own record, `GlobalRegistrator.registered`: the
 * descriptor each global had before it replaced it, or `null` for one it added. Private to
 * TypeScript in 15.11.7 and public at run time; reading it is what makes the swap exact
 * rather than a guessed list of constructors. It is `null` when happy-dom is not registered,
 * and then there is nothing to swap. A happy-dom that renamed it would leave its own
 * `Response` installed, and the server's first request would fail loudly on it rather than
 * pass wrongly.
 */
function liftDom(): () => void {
  const replaced: unknown = Reflect.get(GlobalRegistrator, "registered");
  if (typeof replaced !== "object" || replaced === null) {
    return () => undefined;
  }
  const keys = Reflect.ownKeys(replaced);
  const installed = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of keys) {
    const original: unknown = Reflect.get(replaced, key);
    if (isDescriptor(original)) {
      Object.defineProperty(globalThis, key, original);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  return () => {
    for (const [key, descriptor] of installed) {
      if (descriptor !== undefined) {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  };
}

/**
 * Better Auth's tables by the physical names `060_auth.sql` and `310_mcp_oauth.sql` created --
 * which is what each `modelName` in `handlers/authSchema.ts` resolves to -- for the in-memory
 * adapter, which refuses a model it was not handed. `authSchema.test.ts` holds the real columns
 * to the same models.
 */
const AUTH_TABLES = [
  "auth_user",
  "auth_session",
  "auth_account",
  "auth_verification",
  "auth_jwks",
  "oauth_client",
  "oauth_resource",
  "oauth_client_resource",
  "oauth_refresh_token",
  "oauth_access_token",
  "oauth_consent",
  "oauth_client_assertion",
] as const;

/**
 * Better Auth's store for a suite: its in-memory adapter holding every table the control plane's
 * plugins use, empty. Exported for the suites that build `createAuth` themselves, so a plugin
 * that adds a table is added here once rather than in each of them.
 */
export function inMemoryAuthStore(): BetterAuthOptions["database"] {
  return memoryAdapter(Object.fromEntries(AUTH_TABLES.map((name) => [name, []])));
}

export async function startControlPlane(options: ControlPlaneOptions = {}): Promise<ControlPlane> {
  const restoreDom = liftDom();
  const db = await createMigratedTestDatabase();
  const sender = new InMemoryEmailSender();
  const worker = new InMemoryWorkerClient().backedBy(db);
  const superadmins = options.superadmins ?? new Set<string>();

  // Better Auth needs its `baseUrl` -- also its only trusted origin -- before the socket that
  // decides it is bound, so the server answers through a reference filled in afterwards.
  let handler: (request: Request) => Response | Promise<Response> = () => new Response(null);
  const server = Bun.serve({ port: 0, fetch: (request) => handler(request) });
  const { origin } = server.url;

  const auth = createAuth({
    database: inMemoryAuthStore(),
    exec: db,
    // PGlite is one connection; a transaction adds no isolation to a sequential suite.
    transactor: (fn) => fn(db),
    secret: "a-test-secret-that-is-long-enough-to-sign",
    baseUrl: origin,
    email: sender,
    superadmins,
    ...(options.devSignInAs === undefined ? {} : { devSignInAs: options.devSignInAs }),
  });
  // Built once per test process and shared, as `main.ts` builds them once per server.
  const widgets = await buildWidgets();
  handler = createServer({
    exec: db,
    auth,
    superadmins,
    worker,
    widgets,
    // The repository's own skills, read the way `main.ts` reads them, unless a suite says
    // otherwise. `readSkills` rather than `loadSkills`: a tree that fails should fail the suite.
    skills: options.skills ?? readSkills(SKILLS_ROOT),
    ...(options.log === undefined ? {} : { log: options.log }),
  }).fetch;

  if (options.seed !== undefined) {
    await options.seed(db);
  }
  await db.become("undercroft_app");

  return {
    origin,
    db,
    sender,
    worker,
    stop: async (): Promise<void> => {
      // Awaited and closing live connections, so the next suite cannot reach this database.
      await server.stop(true);
      await db.close();
      restoreDom();
    },
  };
}
