/**
 * Signing in on this machine: the way into a desktop install, whose owner has no password and
 * no mailbox for a code to arrive in (ADR 0094, ADR 0096).
 *
 * The CLI signs in exactly as the install's own page does -- `POST /api/auth/sign-in/dev`, which
 * issues an ordinary Better Auth session for the address the server was configured with -- and
 * keeps that session exactly as it keeps one from an emailed code: under its origin, in
 * `credentials.json`. Nothing after this point knows which way the session was had. So the CLI
 * is still a caller with a person's own session (ADR 0044); no token, no DSN, no second door.
 *
 * It is chosen the way the page chooses it, from what the SERVER says it offers, never from
 * anything stored here: `config.signIn` answering the local method ALONE is a desktop install,
 * and `auth login` and the home page then sign in without asking for an address. Offered beside
 * a method that proves something, it is used only when a person says `--local`. A server that
 * cannot say (an older one, or one that did not answer) is not taken to be a desktop install;
 * the emailed code is asked for as before.
 *
 * This does not touch `allowWrites`. Signing in says who the person is; letting an agent write
 * through a profile is a separate decision a person makes at a terminal (`profiles.ts`).
 */

import { isLoopbackOrigin } from "@undercroft/core/loopback";
import { saveCredential } from "../services/credentials.ts";
import { failure, fromFailure, success } from "../services/output.ts";
import { isRecord } from "../services/store.ts";
import { signInLocally } from "./authEndpoints.ts";
import type { Context } from "./context.ts";
import { type Noted, noted } from "./noted.ts";
import { type Connection, callProcedure } from "./remote.ts";

/** How the method appears in `config.signIn`'s `methods` (`SignInMethod` in the control plane). */
const LOCAL_METHOD = "dev";

export interface SignedLocally {
  readonly noted: Noted;
  /** The address now signed in, or `null` when the sign-in was refused. */
  readonly email: string | null;
}

/** Whether the server's only way in is the local one: a desktop install (ADR 0094). */
export async function offersOnlyLocal(ctx: Context, connection: Connection): Promise<boolean> {
  const offered = await callProcedure(
    ctx.t,
    connection,
    { path: "config.signIn", type: "query" },
    undefined,
  );
  const methods = offered.ok && isRecord(offered.data) ? offered.data.methods : null;
  return Array.isArray(methods) && methods.length === 1 && methods[0] === LOCAL_METHOD;
}

/**
 * Sign in on this machine and keep the session.
 *
 * Refused here, before any request, when the server is not on this machine: the server would
 * refuse it too -- it builds the method only behind a loopback URL -- but this way the person
 * hears why, instead of a NOT_FOUND from a server that has no such endpoint.
 */
export async function signInOnThisMachine(
  ctx: Context,
  connection: Connection,
): Promise<SignedLocally> {
  const { t } = ctx;
  const { origin } = connection;
  if (!isLoopbackOrigin(origin)) {
    return {
      noted: noted(failure("INVALID_ARGUMENT", t("error.localNotLoopback", { origin }))),
      email: null,
    };
  }
  const signed = await signInLocally(t, connection);
  if (!signed.ok) {
    return { noted: noted(signed), email: null };
  }
  const { email, cookie } = signed;
  const saved = saveCredential(t, ctx.home, origin, { email, cookie });
  if (saved !== null) {
    return { noted: noted(fromFailure(saved)), email: null };
  }
  return {
    noted: noted(
      success({ origin, email, signedIn: true }),
      t("note.signedInLocally", { origin, email }),
    ),
    email,
  };
}
