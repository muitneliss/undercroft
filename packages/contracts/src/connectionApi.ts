/**
 * The connection verbs: the wire between the control plane and the worker.
 *
 * The control plane runs the browser half of an OAuth consent, because Google's redirect
 * has to land on a public URL and the worker has none. The worker holds
 * `UNDERCROFT_SECRET_KEY` and is the only process that may seal a credential. So the token
 * bundle crosses one hop, over the internal network, on the same trigger-token allowlist
 * Kestra uses -- and the control plane keeps the property that matters: it can never *read*
 * a stored credential, because it does not have the key. See ADR 0016.
 *
 * These are Zod schemas rather than TypeScript interfaces because the boundary is HTTP.
 * A type would be erased at exactly the point where a mis-shaped body has to be refused.
 */

import { z } from "zod";

/** The sealed bundle, as Google hands it back. */
export const CredentialInput = z.object({
  accessToken: z.string().min(1),
  /**
   * Google only issues one with `access_type=offline&prompt=consent`. Empty means a
   * connection that will work until the access token expires and then need re-consent --
   * recorded honestly rather than papered over.
   */
  refreshToken: z.string(),
  expiresAt: z.string().datetime().nullable(),
});

export const StoreCredentialRequest = z.object({
  source: z.string().min(1),
  tenantId: z.string().min(1),
  /**
   * The provider's own account id -- Google's opaque `sub`. **Never an email address.**
   * `ops.connection` is readable by the BI role, so an address here would be a customer's
   * mailbox on a dashboard. The human-readable label goes to `app.connection_detail`.
   */
  externalAccountId: z.string(),
  /** The space-delimited scope string Google actually granted, which may be narrower. */
  scope: z.string().default(""),
  credential: CredentialInput,
});

export const StoreCredentialResponse = z.object({
  tenantId: z.string(),
  source: z.string(),
  status: z.literal("connected"),
  expiresAt: z.string().nullable(),
});

/** Listing what an admin may choose from. Needs a live token, so it lives in the worker. */
export const BrowseScopeRequest = z.object({
  source: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.enum(["labels"]),
});

export const BrowseScopeResponse = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const RevokeConnectionRequest = z.object({
  source: z.string().min(1),
  tenantId: z.string().min(1),
});

export const RevokeConnectionResponse = z.object({
  /**
   * Whether the provider was told, reported rather than assumed. Our row is gone either
   * way; a grant left standing at Google is a fact the operator needs, because "you can
   * disconnect at any time" is on the consent card.
   */
  revokedUpstream: z.boolean(),
});

export type CredentialInput = z.infer<typeof CredentialInput>;
export type StoreCredentialRequest = z.infer<typeof StoreCredentialRequest>;
export type StoreCredentialResponse = z.infer<typeof StoreCredentialResponse>;
export type BrowseScopeRequest = z.infer<typeof BrowseScopeRequest>;
export type BrowseScopeResponse = z.infer<typeof BrowseScopeResponse>;
export type RevokeConnectionRequest = z.infer<typeof RevokeConnectionRequest>;
export type RevokeConnectionResponse = z.infer<typeof RevokeConnectionResponse>;
