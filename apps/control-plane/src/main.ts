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

import process from "node:process";
import { createAnthropic } from "@ai-sdk/anthropic";
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  createHttpEmailSender,
  createLogger,
  describeError,
  type EmailSender,
  type LarkNotice,
  larkMessage,
  postLark,
} from "@undercroft/core";
import { asExecutor, createPool, withTransaction } from "@undercroft/db";
import { startTelemetry } from "@undercroft/telemetry";
import { createAuth } from "./handlers/auth.ts";
import { createServer } from "./handlers/server.ts";
import { loadSkills } from "./skills.ts";
import { buildWidgets } from "./widgets.ts";
import { runAlerts } from "./services/alerts.ts";
import { createAssistant } from "./services/assistant/agent.ts";
import { createJudge } from "./services/assistant/judge.ts";
import { parseSuperadmins } from "./services/superadmin.ts";
import { createHttpWorkerClient } from "./services/workerClient.ts";

/** How often failures and expiries are looked for. A minute: a notice is not a page. */
const ALERT_TICK_MS = 60_000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

// Before anything logs. An unset OTEL_EXPORTER_OTLP_ENDPOINT is export off; the trace ids are
// stamped either way (ADR 0058).
const telemetry = startTelemetry({ service: "undercroft-control-plane", env: process.env });
const log = createLogger({ component: "control-plane", ...telemetry.logging });
log.info(telemetry.exporting ? "telemetry_exporting" : "telemetry_export_off");

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
 * in -- which is the failure `docs/runbook/sign-in-setup.md` warns about and ADR 0016
 * records. Unset means the per-tenant consent does not exist and every Google source reads
 * "not connected", which is the right state while Google verification is pending.
 */
const ingestClientId = optional("UNDERCROFT_GOOGLE_INGEST_CLIENT_ID");
const ingestClientSecret = optional("UNDERCROFT_GOOGLE_INGEST_CLIENT_SECRET");
const googleIngest =
  ingestClientId === undefined || ingestClientSecret === undefined || publicUrl === undefined
    ? undefined
    : {
        clientId: ingestClientId,
        clientSecret: ingestClientSecret,
        publicUrl,
        // Drive's browser Picker only. Absent means the Gmail half still works and the
        // Drive picker says so, rather than the whole consent flow disappearing.
        ...(optional("UNDERCROFT_GOOGLE_PICKER_API_KEY") === undefined
          ? {}
          : { pickerApiKey: required("UNDERCROFT_GOOGLE_PICKER_API_KEY") }),
        ...(optional("UNDERCROFT_GOOGLE_PROJECT_NUMBER") === undefined
          ? {}
          : { projectNumber: required("UNDERCROFT_GOOGLE_PROJECT_NUMBER") }),
      };

/**
 * The Xero client. The control plane runs the consent with it; the worker holds the same
 * two values to refresh and revoke. Unset means Xero reads "not connected" and its button
 * says why, exactly as the Google client does.
 */
const xeroClientId = optional("UNDERCROFT_XERO_CLIENT_ID");
const xeroClientSecret = optional("UNDERCROFT_XERO_CLIENT_SECRET");
const xero =
  xeroClientId === undefined || xeroClientSecret === undefined || publicUrl === undefined
    ? undefined
    : { clientId: xeroClientId, clientSecret: xeroClientSecret, publicUrl };

/**
 * The worker: the only process holding the master key, and so the only one that may seal a
 * credential. The control plane runs the browser half of a consent and hands the bundle over
 * on the trigger-token allowlist. ADR 0016.
 */
const workerUrl = optional("UNDERCROFT_WORKER_URL");
const triggerToken = optional("UNDERCROFT_TRIGGER_TOKEN");
const worker =
  workerUrl === undefined || triggerToken === undefined
    ? undefined
    : createHttpWorkerClient({ baseUrl: workerUrl, triggerToken });

/**
 * The assistant, if a model key was given.
 *
 * Degrade-and-log rather than crash, like `worker` above and `auth` before it: an install with
 * no key still signs in, still ingests and still draws reports, and the interleaf says it is
 * unavailable. Half-wiring it instead -- a panel that opens and then fails at the first
 * question -- is the "every layer reports success while the feature is invisible" failure
 * ADR 0028 was written about.
 *
 * `claude-opus-5` is a default rather than a required variable: it is the model this was
 * designed against, and making an operator name a model before the feature works is making
 * them read the runbook to type a constant.
 */
const anthropicKey = optional("UNDERCROFT_ANTHROPIC_API_KEY");
const approvalSecret = optional("UNDERCROFT_ASSISTANT_APPROVAL_SECRET");
const assistant =
  anthropicKey === undefined
    ? undefined
    : createAssistant(
        createAnthropic({ apiKey: anthropicKey })(
          optional("UNDERCROFT_ASSISTANT_MODEL") ?? "claude-opus-5",
        ),
        approvalSecret,
      );

/**
 * The injection gate: TypeSafe's System One, asked whether the reader's own words requested an
 * action before one is ever offered. `services/assistant/judge.ts` records why a classifier
 * earns its place here rather than being decoration.
 *
 * Absent is NOT absent: an unconfigured gate becomes `unavailableJudge`, which denies the write
 * tier. So an install with only a model key can answer questions and cannot offer to change
 * anything -- which is the honest degradation, and the one a reader is told about.
 */
const typesafeKey = optional("UNDERCROFT_TYPESAFE_API_KEY");
const judge =
  typesafeKey === undefined
    ? undefined
    : ((): ReturnType<typeof createJudge> => {
        // The vendor's surface lives here, with every other vendor's, and `judge.ts` sees only
        // "state and a question in, a probability or nothing out".
        const client = new TypeSafeClient({ apiKey: typesafeKey });
        return createJudge(async (state, instructions) => {
          const { answers } = await client.systemOne({
            state,
            questions: { asksFor: noul(instructions) },
          });
          return answers.asksFor.noul ?? null;
        });
      })();

if (assistant === undefined) {
  log.info("assistant_unconfigured", { missing: "UNDERCROFT_ANTHROPIC_API_KEY" });
} else {
  log.info("assistant_ready", {
    model: assistant.modelId,
    // Named rather than silent: an operator reading a log after a deploy needs to know the
    // assistant came up read-only, because nothing on the screen will say so until somebody
    // asks it to change something.
    writes: judge === undefined ? "refused: no UNDERCROFT_TYPESAFE_API_KEY" : "gated",
    approvals: approvalSecret === undefined ? "unsigned" : "signed",
  });
}

/**
 * The platform administrators, read here and consulted on every request thereafter.
 *
 * Parsed at boot rather than per request so a malformed entry is reported once, at the
 * moment somebody can still connect it to the deploy they just made, instead of never.
 */
const superadmins = parseSuperadmins(optional("UNDERCROFT_SUPERADMINS"));

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

/**
 * Sign-in without proof, for a local stack. Set by `task dev:api` and by nothing a deployment
 * runs -- the compose files do not pass it -- and `createAuth` refuses it unless the public
 * URL is loopback. It stands in for mail as the one method sign-in cannot be built without,
 * because on a laptop with no mail key it is the only way in.
 */
const devSignInAs = optional("UNDERCROFT_DEV_SIGN_IN_AS");
const google =
  googleClientId === undefined || googleClientSecret === undefined
    ? undefined
    : { clientId: googleClientId, clientSecret: googleClientSecret };

const auth =
  publicUrl === undefined ||
  sessionSecret === undefined ||
  (email === undefined && devSignInAs === undefined)
    ? undefined
    : createAuth({
        database: authPool,
        exec,
        transactor: (fn) => withTransaction(pool, fn),
        secret: sessionSecret,
        baseUrl: publicUrl,
        superadmins: superadmins.addresses,
        ...(email === undefined ? {} : { email }),
        ...(google === undefined ? {} : { google }),
        ...(devSignInAs === undefined ? {} : { devSignInAs }),
        onEmailError: (error): void =>
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
    google: google !== undefined,
  });
} else {
  const methods = [
    ...(google === undefined ? [] : ["google"]),
    ...(email === undefined ? [] : ["email-otp"]),
    ...(devSignInAs === undefined ? [] : ["dev"]),
  ].join(",");
  if (devSignInAs === undefined) {
    log.info("sign_in_configured", { methods });
  } else {
    // `warn`, so the method that proves nothing is never a line nobody reads.
    log.warn("sign_in_configured", { methods });
  }
}

/**
 * How many platform administrators this process will honour, and what it would not read.
 *
 * The COUNT, never the addresses: a log line is the one artefact that reliably leaves the
 * host, and a list of the platform's most privileged accounts is exactly the thing not to
 * put in one. `rejected` is the exception and it is deliberate -- an entry that matches
 * nobody is not an administrator's address, it is a typo, and printing it back is the only
 * way the person who wrote it finds out.
 *
 * Zero is logged at `warn` rather than passed over. It is a legitimate configuration -- an
 * install that bootstrapped long ago and now manages access by invitation needs none -- but
 * it is also exactly what a variable set on the wrong service looks like, and the two are
 * indistinguishable until somebody is locked out.
 */
if (superadmins.rejected.length > 0) {
  log.warn("superadmins_rejected", {
    entries: superadmins.rejected.join(","),
    hint: "UNDERCROFT_SUPERADMINS is a comma-separated list of email addresses",
  });
}

if (superadmins.addresses.size === 0) {
  log.warn("superadmins_none", { variable: "UNDERCROFT_SUPERADMINS" });
} else {
  log.info("superadmins_configured", { count: superadmins.addresses.size });
}

/**
 * The operators' Lark group, where a sync's failure and its recovery are posted as cards.
 *
 * The webhook URL is the credential -- anyone holding it can post into the group -- so it is
 * read here and never logged. The secret is Lark's optional signature check. A different
 * variable from CI's `LARK_WEBHOOK_URL` on purpose: that one is a GitHub secret, this one is
 * the deployment's environment, and the two may name different groups.
 */
const larkUrl = optional("UNDERCROFT_LARK_WEBHOOK_URL");
const lark =
  larkUrl === undefined
    ? undefined
    : (notice: LarkNotice): Promise<void> =>
        postLark(
          { url: larkUrl, secret: optional("UNDERCROFT_LARK_WEBHOOK_SECRET") ?? "" },
          larkMessage(notice),
          {
            fetch: (input, init): Promise<Response> => globalThis.fetch(input, init ?? {}),
            now: () => Date.now(),
          },
        );

/**
 * The alert tick: failed runs and expiring grants and keys, emailed to a tenant's admins, and
 * a sync's failure and recovery posted to the operators' Lark group.
 *
 * Needs a public origin for the links and at least one channel, and starts only then: a tick
 * that claimed failures and then could tell nobody would mark them as told about. With it not
 * started the ledger still records everything; only the notices are missing, and the boot
 * line says so.
 */
if (publicUrl === undefined || (email === undefined && lark === undefined)) {
  log.warn("alerts_unconfigured", {
    email: email !== undefined,
    lark: lark !== undefined,
    publicUrl: publicUrl !== undefined,
  });
} else {
  const alertDeps = {
    exec,
    ...(email === undefined ? {} : { email }),
    ...(lark === undefined ? {} : { lark }),
    publicUrl,
    superadmins: superadmins.addresses,
    log,
  };
  setInterval(() => {
    runAlerts(alertDeps).catch((error: unknown) => {
      log.error("alerts_tick_failed", describeError(error));
    });
  }, ALERT_TICK_MS);
  log.info("alerts_configured", {
    everyMs: ALERT_TICK_MS,
    email: email !== undefined,
    lark: lark !== undefined,
  });
}

// The image bakes the built SPA in and points here; unset, a bare `bun run` serves the API
// alone. Spread so the optional stays absent, not `undefined` (exactOptionalPropertyTypes).
const uiDist = optional("UNDERCROFT_UI_DIST");
// The tag the image was built from (telemetry reads it too), which `/mcp` reports as its version.
const release = optional("UNDERCROFT_RELEASE");
const app = createServer({
  exec,
  // Not spread conditionally: an empty set is the honest answer for an install that names
  // none, and it means `resolveCaller` has one code path rather than two.
  superadmins: superadmins.addresses,
  ...(auth === undefined ? {} : { auth }),
  // Passed independently of `auth`: an invitation email is worth sending even on an install
  // where sign-in itself is not fully configured yet.
  ...(email === undefined ? {} : { email }),
  ...(publicUrl === undefined ? {} : { publicUrl }),
  ...(release === undefined ? {} : { release }),
  ...(uiDist === undefined ? {} : { uiDist }),
  ...(googleIngest === undefined ? {} : { googleIngest }),
  ...(xero === undefined ? {} : { xero }),
  ...(worker === undefined ? {} : { worker }),
  ...(assistant === undefined ? {} : { assistant }),
  ...(judge === undefined ? {} : { judge }),
  // `/mcp`'s widgets (ADR 0061) and skills (ADR 0067): a failure is logged and serves none.
  widgets: await buildWidgets(log),
  skills: loadSkills(log),
  log,
});

// Flush what is buffered: a stop that dropped it would lose the requests a deploy cut short.
process.once("SIGTERM", () => void telemetry.shutdown().finally(() => process.exit(0)));

// parseInt, not Number(): a port, not an amount.
const port = Number.parseInt(process.env.UNDERCROFT_API_PORT ?? "3000", 10);
log.info("listening", { port });

export default { port, fetch: app.fetch };
