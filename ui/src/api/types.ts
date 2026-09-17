/** Mirrors vcdo/api/models.py. Money is a string here for the reason given there. */

import type { Money } from "@/lib/money";

export type Source = "hubspot" | "xero" | "gmail" | "drive";

export const SOURCES: readonly Source[] = ["hubspot", "xero", "gmail", "drive"] as const;

export const SOURCE_LABEL: Record<Source, string> = {
  hubspot: "HubSpot",
  xero: "Xero",
  gmail: "Gmail",
  drive: "Google Drive",
};

/**
 * What the platform will read, in the customer's words rather than ours.
 *
 * Shown on the card BEFORE the redirect. Someone is about to hand over access to
 * their company email and their accounting system; "Connect Gmail" with no
 * statement of what that means is not consent, it is a dark pattern.
 */
export const SOURCE_ACCESS: Record<Source, { reads: string; writes: string }> = {
  hubspot: {
    reads: "Companies, contacts and deals from your CRM.",
    writes: "Nothing. Read-only access, and you can disconnect at any time.",
  },
  xero: {
    reads: "Invoices, payments, credit notes and contacts from one organisation you choose.",
    writes: "Nothing. Read-only access, and you can disconnect at any time.",
  },
  gmail: {
    reads: "Message headers and PDF attachments from the mailbox you connect.",
    writes: "Nothing. Read-only access, and you can disconnect at any time.",
  },
  drive: {
    reads: "PDF documents inside the folders you select. No other folder is read.",
    writes: "Nothing. Read-only access, and you can disconnect at any time.",
  },
};

export type ConnectionStatus =
  | "disconnected"
  | "connected"
  | "needs_scope"
  | "needs_reconnect";

export type Connection = {
  source: Source;
  status: ConnectionStatus;
  external_account_id: string;
  external_account_label: string;
  scopes: string[];
  config: { folder_ids?: string[]; labels?: string[]; entities?: string[] };
  schedule_cron: string;
  last_run_id: string;
  expires_at: string | null;
};

export type Tenant = {
  id: string;
  display_name: string;
  status: string;
  created_at: string;
};

export type Member = {
  id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
  role: string | null;
};

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
};

export type LakeObject = {
  key: string;
  versions: number;
  newest_sha256: string | null;
  bytes: number | null;
};

/** Present so the money type is used; the overview endpoint returns these. */
export type CustomerTotals = {
  customer: string;
  invoiced: Money | null;
  outstanding: Money | null;
};
