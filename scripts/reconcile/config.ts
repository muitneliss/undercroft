/**
 * The live run's configuration: which clients, where the credentials are, where evidence goes.
 *
 * NOTHING HERE IS COMMITTED WITH REAL VALUES. The file holds client folder ids and token paths,
 * so it lives under `fixtures/live/` (git-ignored) or anywhere outside the repository, and is
 * named on the command line. `reconcile.config.example.json` beside this module shows the
 * shape with placeholders. A client is named by its CASE-ID (or an internal client id when it
 * has none) -- never by its name -- because that label is what reaches the tracked report.
 *
 * `outDir` must be outside the repository: the detailed evidence names real messages and
 * files. `loadConfig` refuses an `outDir` inside the repo rather than trusting `.gitignore`.
 */

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { ReconcileError } from "./errors.ts";
import { asArray, asObject } from "./json.ts";

const QUOTES = /^["']|["']$/gu;

export type MailboxName = "primary" | "secondary";

export interface MailboxConfig {
  /** The address the token must read; checked against Gmail's own profile answer. */
  readonly address: string;
  readonly tokenFile: string;
  /** The Undercroft lake source holding this mailbox, e.g. `gmail` or `gmail.<suffix>`. */
  readonly undercroftSource: string;
}

export interface DriveRootConfig {
  /** A name for reports: `incorp-shared`, `incorp-mydrive`, `bookkeeping`. */
  readonly role: string;
  /** Which mailbox's token can read it. */
  readonly readAs: MailboxName;
  /** The Undercroft source that scopes it, or null when Undercroft does not read this root. */
  readonly undercroftSource: string | null;
  /** Whether OSTWIN's inventory scans this root. */
  readonly ostwinScans: boolean;
}

export interface ClientDriveFolder {
  readonly role: string;
  readonly folderId: string;
}

export interface ClientConfig {
  /** CASE-ID, or an internal client id when the client has none. Reaches the tracked report. */
  readonly label: string;
  /** The OSTWIN CASE-ID for Gmail source queries; null when OSTWIN has none. */
  readonly caseId: string | null;
  /** The OSTWIN client id (the old warehouse's own id), for mart queries. */
  readonly clientId: string;
  readonly hubspotCompanyIds: readonly string[];
  readonly driveFolders: readonly ClientDriveFolder[];
}

export interface LiveConfig {
  readonly tenantId: string;
  readonly ostwinRoot: string;
  readonly outDir: string;
  readonly hubspotEnvFile: string;
  readonly mailboxes: Readonly<Record<MailboxName, MailboxConfig>>;
  readonly driveRoots: readonly DriveRootConfig[];
  readonly clients: readonly ClientConfig[];
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
  const clients = asArray(body.clients).map((item, index) => {
    const entry = asObject(item);
    const label = str(entry.label, `clients[${index}].label`);
    return {
      label,
      caseId: entry.caseId === null ? null : str(entry.caseId, `${label}.caseId`),
      clientId: str(entry.clientId, `${label}.clientId`),
      hubspotCompanyIds: asArray(entry.hubspotCompanyIds).map((id) =>
        str(id, `${label}.hubspotCompanyIds`),
      ),
      driveFolders: asArray(entry.driveFolders).map((folder) => {
        const value = asObject(folder);
        return {
          role: str(value.role, `${label}.driveFolders.role`),
          folderId: str(value.folderId, `${label}.driveFolders.folderId`),
        };
      }),
    };
  });
  const labels = new Set<string>();
  for (const client of clients) {
    if (labels.has(client.label)) {
      throw new ReconcileError(`client label ${client.label} appears twice`, { code: "CONFIG" });
    }
    labels.add(client.label);
  }
  return {
    tenantId: str(body.tenantId, "tenantId"),
    ostwinRoot: str(body.ostwinRoot, "ostwinRoot"),
    outDir: str(body.outDir, "outDir"),
    hubspotEnvFile: str(body.hubspotEnvFile, "hubspotEnvFile"),
    mailboxes: { primary: mailbox("primary"), secondary: mailbox("secondary") },
    driveRoots: asArray(body.driveRoots).map((item) => {
      const entry = asObject(item);
      const readAs = str(entry.readAs, "driveRoots.readAs");
      if (readAs !== "primary" && readAs !== "secondary") {
        throw new ReconcileError(`driveRoots.readAs must be primary or secondary, got ${readAs}`, {
          code: "CONFIG",
        });
      }
      return {
        role: str(entry.role, "driveRoots.role"),
        readAs,
        undercroftSource:
          entry.undercroftSource === null ? null : str(entry.undercroftSource, "undercroftSource"),
        ostwinScans: entry.ostwinScans === true,
      };
    }),
    clients,
  };
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReconcileError(`${field} must be a non-empty string`, { code: "CONFIG" });
  }
  return value.trim();
}

/** Read `NAME=value` from an env file without putting the file's other lines anywhere. */
export function readEnvValue(path: string, name: string): string | null {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const value = trimmed.slice(name.length + 1).trim();
      return value.replace(QUOTES, "");
    }
  }
  return null;
}
