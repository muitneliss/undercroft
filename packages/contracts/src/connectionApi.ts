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
  /**
   * Probe the provider with the credential before sealing it. For a token an admin pasted
   * rather than one a provider just issued: a typo would otherwise seal cleanly, read as
   * "connected", and 401 at the next run far from the paste that caused it.
   */
  validate: z.boolean().default(false),
});

export const StoreCredentialResponse = z.object({
  tenantId: z.string(),
  source: z.string(),
  status: z.literal("connected"),
  expiresAt: z.string().nullable(),
});

/**
 * What one source's scope is chosen from, named for the thing listed.
 *
 * `labels` is Gmail's; `organisations` is Xero's -- the organisations one consent can see,
 * of which the platform must be told one rather than guess; `folders` is Drive's, and carries
 * the file types found across the grant beside them, because a Drive scope is chosen as both.
 * ADR 0047.
 */
export const BrowseListing = z.enum(["labels", "organisations", "folders"]);

/** Listing what an admin may choose from. Needs a live token, so it lives in the worker. */
export const BrowseScopeRequest = z.object({
  source: z.string().min(1),
  tenantId: z.string().min(1),
  kind: BrowseListing,
});

/** The item kinds a listing can be cut short in. Labels and organisations never are. */
const Bounded = z.enum(["folder", "file-type"]);

export const BrowseScopeResponse = z.object({
  items: z.array(
    z.object({
      /**
       * What a scope records for this item: a label or organisation id, a Drive folder id, or
       * -- for a `file-type` -- the MIME type itself, which is what `fileTypes` takes.
       */
      id: z.string(),
      name: z.string(),
      /**
       * What sort of choice this is.
       *
       * For a label, who owns it, as the provider reports it: `system` for the set Gmail
       * ships (INBOX, SENT, the CATEGORY_* group) and `user` for one somebody made. For Drive,
       * `folder` -- spelled as a Drive pick spells it, so `{ id, name, kind }` pastes into a
       * `DriveScope`'s `files` unchanged -- or `file-type`, a MIME type present in the grant.
       *
       * Kept THREE-VALUED for a label. A provider that does not say leaves `null`, and the
       * picker gives that its own run rather than filing it under "yours" -- which would be a
       * claim about who made a label, made up by us, on the screen where an admin decides what
       * a customer has agreed to hand over. `.claude/rules/money.md` is where that rule is
       * written down, and it is about values rather than amounts.
       *
       * Defaulted rather than required so a worker built before this field answers a control
       * plane built after it: the missing field becomes "not classified", which is true.
       */
      kind: z.enum(["system", "user", "folder", "file-type"]).nullable().default(null),
      /**
       * A folder's place in its drive, outermost first and ending with its own name: a shared
       * drive's name leads when the folder is in one. Absent for anything that is not a
       * folder. It starts at the outermost folder the grant can see, which for a folder shared
       * with the account from somebody else's drive is that folder itself.
       */
      path: z.array(z.string()).optional(),
    }),
  ),
  /**
   * The item kinds this answer does NOT hold every one of, because the listing stopped at its
   * bound or Google said its own search was incomplete. Empty means complete.
   *
   * Said rather than left to be inferred, because a list that stopped at five thousand files
   * looks exactly like a drive that holds five thousand files, and "the only types present
   * are these" is a claim the admin then acts on. CLAUDE.md rule 2. A folder path computed
   * from a cut listing may begin lower than it should, which `folder` here also covers.
   *
   * Defaulted to empty so a worker built before this field answers a control plane built
   * after it -- and every such worker listed only labels and organisations, whole, so empty
   * is what its answer was.
   */
  partial: z.array(Bounded).default([]),
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
export type BrowseListing = z.infer<typeof BrowseListing>;
export type BrowseScopeRequest = z.infer<typeof BrowseScopeRequest>;
export type BrowseScopeResponse = z.infer<typeof BrowseScopeResponse>;
export type RevokeConnectionRequest = z.infer<typeof RevokeConnectionRequest>;
export type RevokeConnectionResponse = z.infer<typeof RevokeConnectionResponse>;
