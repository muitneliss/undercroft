/**
 * The control plane's process entrypoint. Wires the real Postgres pool into the server and
 * listens on :3000.
 *
 * Sign-in is assembled here or not at all. If its configuration is incomplete the process
 * starts with NO auth rather than a half-wired one: a `/api/auth/*` route that exists but
 * cannot reach Google, or cannot send a code, fails at the first click with an error that
 * looks like a bug in the platform. One log line at boot saying sign-in is unconfigured is a
 * far cheaper thing to debug. `ServerDeps.auth` is optional precisely so this is expressible.
 */

import { createHttpEmailSender, createLogger, type EmailSender } from "@undercroft/core";
import { asExecutor, createPool, withTransaction } from "@undercroft/db";
import { createAuth } from "./handlers/auth.ts";
import { createServer } from "./handlers/server.ts";
import { createHttpWorkerClient } from "./services/workerClient.ts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

const log = createLogger({ component: "control-plane" });

const dsn = required("UNDERCROFT_POSTGRES_DSN");
const pool = createPool(dsn);
const exec = asExecutor(pool);

/**
 * Better Auth gets its own pool, whose `search_path` makes its unqualified table names
 * resolve inside `app`. A second pool rather than a setting on the shared one: the rest of
 * the codebase qualifies every table, and a library's expectations should not quietly change
 * what a bare table name means for everything else.
 */
const authPool = createPool(dsn, { searchPath: "app" });

const publicUrl = optional("UNDERCROFT_PUBLIC_URL");
const sessionSecret = optional("UNDERCROFT_SESSION_SECRET");
const mailApiKey = optional("UNDERCROFT_EMAIL_API_KEY");
const mailFrom = optional("UNDERCROFT_EMAIL_FROM");
const googleClientId = optional("UNDERCROFT_GOOGLE_CLIENT_ID");
const googleClientSecret = optional("UNDERCROFT_GOOGLE_CLIENT_SECRET");

/**
 * A SECOND Google client, for ingestion.
 *
 * Separate from the sign-in one above on purpose. Signing in asks for `openid email
 * profile`; this asks for a customer's mailbox or documents. One client carrying both scope
 * lists is one misconfiguration away from handing over a mailbox as a side effect of signing
 * in -- which is the failure `docs/runbook/sign-in-setup.md` warns about and ADR 0014
 * records. Unset means the per-tenant consent does not exist and every Google source reads
 * "not connected", which is the right state while Google verification is pending.
 */
const ingestClientId = optional("UNDERCROFT_GOOGLE_INGEST_CLIENT_ID");
const ingestClientSecret = optional("UNDERCROFT_GOOGLE_INGEST_CLIENT_SECRET");
const googleIngest =
  ingestClientId === undefined || ingestClientSecret === undefined || publicUrl === undefined
    ? undefined
    : { clientId: ingestClientId, clientSecret: ingestClientSecret, publicUrl };

/**
 * The worker: the only process holding the master key, and so the only one that may seal a
 * credential. The control plane runs the browser half of a consent and hands the bundle over
 * on the trigger-token allowlist. ADR 0014.
 */
const workerUrl = optional("UNDERCROFT_WORKER_URL");
const triggerToken = optional("UNDERCROFT_TRIGGER_TOKEN");
const worker =
  workerUrl === undefined || triggerToken === undefined
    ? undefined
    : createHttpWorkerClient({ baseUrl: workerUrl, triggerToken });

const email: EmailSender | undefined =
  mailApiKey === undefined || mailFrom === undefined
    ? undefined
    : createHttpEmailSender({
        apiKey: mailApiKey,
        from: mailFrom,
        ...(optional("UNDERCROFT_EMAIL_API_URL") === undefined
          ? {}
          : { endpoint: required("UNDERCROFT_EMAIL_API_URL") }),
      });

const auth =
  publicUrl === undefined || sessionSecret === undefined || email === undefined
    ? undefined
    : createAuth({
        database: authPool,
        exec,
        transactor: (fn) => withTransaction(pool, fn),
        secret: sessionSecret,
        baseUrl: publicUrl,
        email,
        ...(googleClientId === undefined || googleClientSecret === undefined
          ? {}
          : { google: { clientId: googleClientId, clientSecret: googleClientSecret } }),
        onEmailError: (error) =>
          log.error("otp_send_failed", {
            errorMessage: error instanceof Error ? error.message : String(error),
          }),
      });

if (auth === undefined) {
  // Named, so the fix is obvious. Anything absent here means nobody can sign in.
  log.warn("sign_in_unconfigured", {
    publicUrl: publicUrl !== undefined,
    sessionSecret: sessionSecret !== undefined,
    email: email !== undefined,
    google: googleClientId !== undefined && googleClientSecret !== undefined,
  });
} else if (googleClientId === undefined) {
  log.info("sign_in_configured", { methods: "email-otp" });
} else {
  log.info("sign_in_configured", { methods: "google,email-otp" });
}

// The image bakes the built SPA in and points here; a bare `bun run` with the variable
// unset serves the API alone. Spread so the optional stays absent rather than `undefined`,
// which exactOptionalPropertyTypes forbids.
const uiDist = optional("UNDERCROFT_UI_DIST");
const app = createServer({
  exec,
  ...(auth === undefined ? {} : { auth }),
  // Passed independently of `auth`: an invitation email is worth sending even on an install
  // where sign-in itself is not fully configured yet.
  ...(email === undefined ? {} : { email }),
  ...(publicUrl === undefined ? {} : { publicUrl }),
  ...(uiDist === undefined ? {} : { uiDist }),
  ...(googleIngest === undefined ? {} : { googleIngest }),
  ...(worker === undefined ? {} : { worker }),
});

// parseInt, not Number(): a port, not an amount.
const port = parseInt(process.env.UNDERCROFT_API_PORT ?? "3000", 10);
log.info("listening", { port });

export default { port, fetch: app.fetch };
