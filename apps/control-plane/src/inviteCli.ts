/**
 * Invite someone from the command line.
 *
 *   bun run invite -- ada@example.test --tenant CASE-0001 --role admin
 *
 * This exists for exactly one situation the product cannot serve itself: the **first**
 * admin. Invitations are issued from the People page, but that needs somebody signed in,
 * and on a fresh deployment nobody is. Before this, the answer was "paste two INSERTs into
 * psql", which is how the first production sign-in got stuck for a round of guessing.
 *
 * It is a composition root, like `main.ts`: it reads the environment, builds the pool, and
 * calls the same `people.invite` service the tRPC handler calls. That service was written to
 * return values rather than `TRPCError` precisely so a second caller like this one could
 * exist without catching HTTP errors -- this is that caller.
 *
 * It does NOT bypass the gate. It writes an ordinary `app.invitation` row; the person still
 * has to prove they control the address, through Google or a one-time code. The only thing
 * it grants is the right to try.
 */

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.
// biome-ignore-all lint/style/noProcessEnv: The composition root reads configuration from the environment on purpose; `.claude/rules/layering.md` puts it here precisely so that no layer below does. That direction is enforced separately by the `layer-injected-deps` ast-grep rule, which is the check that actually binds.

import process from "node:process";
import { createHttpEmailSender, type EmailSender } from "@undercroft/core";
import { asExecutor, createPool, withTransaction } from "@undercroft/db";
import { ensureTenant, findTenant } from "./repos/tenant.ts";
import * as people from "./services/people.ts";
import { invitationMessage } from "./services/people.ts";

const ROLES = new Set(["viewer", "member", "admin"]);

interface Args {
  readonly email: string;
  readonly tenantId: string;
  readonly role: string;
  /** Create the tenant if it is missing. Off by default: a typo must not invent a customer. */
  readonly createTenant: boolean;
}

function usage(message: string): never {
  process.stderr.write(
    `${message}\n\n` +
      "usage: bun run invite -- <email> --tenant <id> [--role viewer|member|admin] [--create-tenant]\n" +
      "\n" +
      "  --create-tenant   create the tenant if it does not exist (for the first admin)\n",
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  let email = "";
  let tenantId = "";
  let role = "admin";
  let createTenant = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tenant") {
      i += 1;
      tenantId = argv[i] ?? "";
    } else if (arg === "--role") {
      i += 1;
      role = argv[i] ?? "";
    } else if (arg === "--create-tenant") {
      createTenant = true;
    } else if (arg !== undefined && !arg.startsWith("--")) {
      email = arg;
    } else {
      usage(`unknown option ${String(arg)}`);
    }
  }

  if (email === "") {
    usage("an email address is required");
  }
  if (tenantId === "") {
    usage("--tenant is required");
  }
  if (!ROLES.has(role)) {
    usage(`--role must be one of ${[...ROLES].join(", ")}`);
  }
  return { email, tenantId, role, createTenant };
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The same message the People page sends, or nothing.
 *
 * With no mail configured the invitation is still written and still works -- the caller is
 * told it was not sent, so they know to pass the address on themselves. Reported, never
 * assumed: an admin who thinks an email went out will wait for someone who was never told.
 */
function buildNotifier(): (email: string, tenantId: string) => Promise<boolean> {
  const apiKey = optional("UNDERCROFT_EMAIL_API_KEY");
  const from = optional("UNDERCROFT_EMAIL_FROM");
  const publicUrl = optional("UNDERCROFT_PUBLIC_URL");
  if (apiKey === undefined || from === undefined || publicUrl === undefined) {
    return () => Promise.resolve(false);
  }

  const endpoint = optional("UNDERCROFT_EMAIL_API_URL");
  const sender: EmailSender = createHttpEmailSender({
    apiKey,
    from,
    ...(endpoint === undefined ? {} : { endpoint }),
  });

  return async (to, tenantId) => {
    try {
      await sender.send(invitationMessage(to, tenantId, publicUrl));
      return true;
    } catch {
      return false;
    }
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dsn = process.env["UNDERCROFT_POSTGRES_DSN"];
  if (dsn === undefined || dsn === "") {
    throw new Error("UNDERCROFT_POSTGRES_DSN is required");
  }

  const pool = createPool(dsn);
  try {
    const exec = asExecutor(pool);

    if ((await findTenant(exec, args.tenantId)) === null) {
      if (!args.createTenant) {
        throw new Error(
          `tenant ${args.tenantId} does not exist. Re-run with --create-tenant to create it.`,
        );
      }
      await ensureTenant(exec, args.tenantId, args.tenantId);
      process.stdout.write(`created tenant ${args.tenantId}\n`);
    }

    // One transaction: the invitation and its audit row are one fact.
    const result = await withTransaction(pool, (tx) =>
      people.invite(tx, {
        tenantId: args.tenantId,
        email: args.email,
        role: args.role,
        actor: "cli",
        notify: buildNotifier(),
      }),
    );

    if (!result.ok) {
      if (result.reason === "already-member") {
        process.stdout.write(`${args.email} already has access as ${result.role}\n`);
        return;
      }
      throw new Error(`could not create the invitation for ${args.email}`);
    }

    process.stdout.write(
      `invited ${args.email} to ${args.tenantId} as ${args.role}\n` +
        (result.notified
          ? "an email has been sent\n"
          : "NOT emailed (mail is not configured) — tell them to sign in with that exact address\n"),
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
