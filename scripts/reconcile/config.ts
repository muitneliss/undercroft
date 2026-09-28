/**
 * The live run's configuration: which mailboxes, where their read tokens are, where evidence goes.
 *
 * NOTHING HERE IS COMMITTED WITH REAL VALUES. The file holds mailbox addresses and token paths,
 * so it lives under `fixtures/live/` (git-ignored) or anywhere outside the repository.
 * `live/gmail.config.example.json` shows the shape with placeholders.
 *
 * `outDir` must be outside the repository: the detailed evidence names real messages.
 * `loadConfig` refuses an `outDir` inside the repo rather than trusting `.gitignore`.
 */

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { ReconcileError } from "./errors.ts";
import { asObject } from "./json.ts";

export type MailboxName = "primary" | "secondary";

export interface MailboxConfig {
  /** The address the token must read; checked against Gmail's own profile answer. */
  readonly address: string;
  readonly tokenFile: string;
  /** The Undercroft lake source holding this mailbox, e.g. `gmail` or `gmail.<suffix>`. */
  readonly undercroftSource: string;
}

export interface LiveConfig {
  readonly tenantId: string;
  readonly outDir: string;
  readonly mailboxes: Readonly<Record<MailboxName, MailboxConfig>>;
}

export function loadConfig(path: string, repoRoot: string): LiveConfig {
  const config = parseConfig(JSON.parse(readFileSync(path, "utf8")));
  const out = resolve(config.outDir);
  const repo = resolve(repoRoot);
  if (out === repo || out.startsWith(`${repo}${sep}`)) {
    throw new ReconcileError(
      `outDir ${out} is inside the repository; detailed evidence names real records and must live outside it`,
      { code: "CONFIG" },
    );
  }
  return config;
}

export function parseConfig(raw: unknown): LiveConfig {
  const body = asObject(raw);
  const mailboxes = asObject(body.mailboxes);
  function mailbox(name: MailboxName): MailboxConfig {
    const entry = asObject(mailboxes[name]);
    return {
      address: str(entry.address, `mailboxes.${name}.address`),
      tokenFile: str(entry.tokenFile, `mailboxes.${name}.tokenFile`),
      undercroftSource: str(entry.undercroftSource, `mailboxes.${name}.undercroftSource`),
    };
  }
  const primary = mailbox("primary");
  const secondary = mailbox("secondary");
  // One lake source for both mailboxes would judge each mailbox against the other's rows.
  if (primary.undercroftSource === secondary.undercroftSource) {
    throw new ReconcileError(
      `both mailboxes name the lake source ${primary.undercroftSource}; each mailbox has its own`,
      { code: "CONFIG" },
    );
  }
  return {
    tenantId: str(body.tenantId, "tenantId"),
    outDir: str(body.outDir, "outDir"),
    mailboxes: { primary, secondary },
  };
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReconcileError(`${field} must be a non-empty string`, { code: "CONFIG" });
  }
  return value.trim();
}
