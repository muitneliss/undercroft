/**
 * Signing in with a personal access token: the way in for a script or an agent with nobody at
 * its terminal to type an emailed code (ADR 0134).
 *
 * `auth login --token-env <VAR>` names the environment variable a token minted on `/account` is
 * in, never the token: argv is visible to every process on the machine and kept in shell
 * history, and a value given here would have to be stored to be used again. So the variable is
 * read, the token is proven by asking the server who it belongs to (`session.me`, the same call
 * `auth status` makes), and only the variable's NAME is kept, under the origin, beside the
 * address. Every later call reads the variable again (`credentials.presented`), so rotating the
 * token is changing the variable, and revoking it on `/account` stops the next call.
 *
 * The token is the person's own, with the grant they minted it with, and nothing here widens it:
 * a profile's `allowWrites` still applies on top (`safety.ts`), and the server's grant guard
 * still refuses a `read` token's write.
 */

import { isVariableName, presented, saveCredential } from "../services/credentials.ts";
import { failure, fromFailure, success } from "../services/output.ts";
import { isRecord } from "../services/store.ts";
import type { Context } from "./context.ts";
import { type Noted, noted } from "./noted.ts";
import { type Connection, callProcedure, unreachable } from "./remote.ts";

export async function signInWithToken(
  ctx: Context,
  connection: Connection,
  variable: string,
): Promise<Noted> {
  const { t } = ctx;
  const { origin } = connection;
  // Not echoed: a value that is not a name is most likely the token itself.
  if (!isVariableName(variable)) {
    return noted(failure("INVALID_ARGUMENT", t("error.tokenEnvName")));
  }
  const credential = { email: "", tokenEnv: variable };
  const me = await callProcedure(
    t,
    { ...connection, credential: presented(credential, ctx.env) },
    { path: "session.me", type: "query" },
    undefined,
  );
  if (!me.ok) {
    return noted(me);
  }
  // `session.me` always names the address; an answer that does not is not Undercroft's.
  const email = isRecord(me.data) ? me.data.email : undefined;
  if (typeof email !== "string" || email === "") {
    return noted(unreachable(t, connection, null));
  }
  const saved = saveCredential(t, ctx.home, origin, { ...credential, email });
  if (saved !== null) {
    return noted(fromFailure(saved));
  }
  return noted(
    success({ origin, email, signedIn: true, tokenEnv: variable }),
    t("note.signedInWithToken", { origin, email, variable }),
  );
}
