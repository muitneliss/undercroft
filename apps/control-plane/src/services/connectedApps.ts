/**
 * Connected apps: the model-context clients a person let in by signing in and consenting,
 * rather than by pasting a token (ADR 0061, the second half of ADR 0060).
 *
 * A connector like claude.ai obtains an OAuth access token from this control plane; the person
 * chose, on `/consent`, whether it may read or also write. This module owns what that choice
 * MEANS -- which scopes are a grant of what -- and the two things a person can do about an app
 * afterwards: see it, and revoke it. It owns nothing about OAuth itself: Better Auth is the
 * authorization server and keeps the clients and consents, and `handlers/mcpAuth.ts` answers
 * the narrow {@link OAuthApps} port below over it. So this file never learns a model name, a
 * column or a claim, and `mcpAuth.ts` never learns what `undercroft:write` lets through.
 */

import type { SqlExecutor } from "@undercroft/db";
import { record as recordAudit } from "../repos/auditLog.ts";
import type { Grant } from "./accessTokens.ts";

/** The scope a client asks for to read: every tool classified `read`. */
export const READ_SCOPE = "undercroft:read";
/** The scope a client asks for to write: every tool the person's role allows. Implies read. */
export const WRITE_SCOPE = "undercroft:write";

/**
 * Every scope the authorization server offers, ours first. The OpenID ones are what a client
 * library adds on its own -- `offline_access` is how it gets a refresh token and so does not
 * send the person through consent each time an access token lapses -- and grant nothing here
 * by themselves.
 */
export const OFFERED_SCOPES = [
  READ_SCOPE,
  WRITE_SCOPE,
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;

/**
 * What one set of scopes lets through, or `null` for a set that names neither of ours.
 *
 * `write` implies `read`: a person who granted a connector the right to change things did not
 * mean it to be unable to look first, and the consent page offers write as "read and write".
 */
export function grantOf(scopes: readonly string[]): Grant | null {
  if (scopes.includes(WRITE_SCOPE)) {
    return "write";
  }
  return scopes.includes(READ_SCOPE) ? "read" : null;
}

/**
 * The grant a presented access token holds: the LESSER of what the token says and what the
 * person's consent says now.
 *
 * Both, because they answer different questions. The token carries what was granted when it
 * was issued; the consent row is read on every request, so it is what the person says today.
 * A token minted under a write consent must not keep writing after the person narrowed it to
 * read, and a token minted read must not start writing because a later consent widened --
 * the client asked for less than it could have had, and gets that.
 */
export function grantFor(
  tokenScopes: readonly string[],
  consentScopes: readonly string[],
): Grant | null {
  const token = grantOf(tokenScopes);
  const consent = grantOf(consentScopes);
  if (token === null || consent === null) {
    return null;
  }
  return token === "write" && consent === "write" ? "write" : "read";
}

/** One app a person has let in, as the authorization server keeps it. */
export interface AuthorizedApp {
  /** The consent's id: what a revocation names. */
  readonly id: string;
  /** What the client called itself when it registered, if anything. Self-asserted. */
  readonly clientName: string | null;
  /** Where the client sends a person back to after consent, which is what identifies it. */
  readonly redirectHost: string | null;
  readonly scopes: readonly string[];
  /** When the person last consented, ISO-8601; `null` where the server did not record it. */
  readonly grantedAt: string | null;
}

/**
 * What this module needs from the authorization server, keyed by the person's address -- the
 * one identity the platform and Better Auth share (`services/invite.ts`).
 */
export interface OAuthApps {
  /** The apps this person has consented to, newest first. */
  readonly listFor: (email: string) => Promise<AuthorizedApp[]>;
  /**
   * Withdraw the consent `id` if it is this person's, and stop its refresh tokens, so the app
   * can neither call `/mcp` again nor obtain a new access token. `false` when there was none.
   */
  readonly revokeFor: (email: string, id: string) => Promise<boolean>;
}

/** An app on the account page. `grant` is `null` for one that holds neither of our scopes. */
export interface ConnectedApp {
  readonly id: string;
  readonly name: string | null;
  readonly redirectHost: string | null;
  readonly grant: Grant | null;
  readonly grantedAt: string | null;
}

export async function list(apps: OAuthApps, email: string): Promise<ConnectedApp[]> {
  const authorized = await apps.listFor(email);
  return authorized.map((app) => ({
    id: app.id,
    name: app.clientName,
    redirectHost: app.redirectHost,
    grant: grantOf(app.scopes),
    grantedAt: app.grantedAt,
  }));
}

/** Revoke one of this person's apps, and record it. `false` when there was none to revoke. */
export async function revoke(
  exec: SqlExecutor,
  apps: OAuthApps,
  input: { email: string; id: string },
): Promise<boolean> {
  const revoked = await apps.revokeFor(input.email, input.id);
  if (!revoked) {
    return false;
  }
  try {
    await recordAudit(exec, {
      tenantId: null,
      actor: input.email,
      action: "account.apps.revoke",
      detail: JSON.stringify({ id: input.id }),
    });
  } catch {
    // Swallowed like every audit write in `accessTokens.ts`: the revocation already happened,
    // and failing the call now would tell the person it had not.
  }
  return true;
}
