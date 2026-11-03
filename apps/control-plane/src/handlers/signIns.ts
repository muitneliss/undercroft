/**
 * What Better Auth holds that lets a person back in without signing in again -- their sessions,
 * and, where this control plane is an authorization server, the consents and refresh tokens of
 * the model-context apps they let in -- and the one way to take all of it away (ADR 0152).
 *
 * Through the library's own adapter and model names (`authSchema.ts`), never a statement of
 * ours: these tables are Better Auth's, kept wherever its `database` says, and a `DELETE` in a
 * repo would be a second writer of tables whose shape a plugin upgrade may change. It is also
 * what makes the offline gate prove it: there the store is Better Auth's in-memory adapter, and
 * a statement against PGlite would revoke nothing the server under test reads.
 *
 * Revoked in the order `mcpAuth.ts`'s `revokeApp` revokes one app: refresh tokens first, so an
 * app can mint nothing new while the consent is going; then the consents, which `/mcp` reads on
 * every call; then the sessions. A refresh token already revoked keeps its moment.
 */

import type { AuthContext } from "better-auth";
import type { Withdrawn } from "../services/users.ts";

/** Better Auth's own storage, which knows the model mapping in `authSchema.ts`. */
type Store = Pick<AuthContext, "adapter" | "internalAdapter">;

const NOTHING: Withdrawn = { sessions: 0, refreshTokens: 0, consents: 0 };

/**
 * Withdraw everything Better Auth holds for the person at `email`. `oauth` is whether the
 * authorization server's plugins are installed: without them its models do not exist, and
 * there is nothing of theirs to withdraw.
 */
export async function withdrawSignIns(
  store: Store,
  email: string,
  oauth: boolean,
): Promise<Withdrawn> {
  const found = await store.internalAdapter.findUserByEmail(email.toLowerCase());
  if (found === null) {
    return NOTHING;
  }
  const mine = [{ field: "userId", value: found.user.id }];
  const refreshTokens = oauth
    ? await store.adapter.updateMany({
        model: "oauthRefreshToken",
        where: [...mine, { field: "revoked", value: null }],
        update: { revoked: new Date() },
      })
    : 0;
  const consents = oauth
    ? await store.adapter.deleteMany({ model: "oauthConsent", where: mine })
    : 0;
  const sessions = await store.adapter.deleteMany({ model: "session", where: mine });
  return { sessions, refreshTokens, consents };
}
