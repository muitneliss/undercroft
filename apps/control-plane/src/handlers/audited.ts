/**
 * Who writes each mutation's audit row (ADR 0112): a fact about a procedure the router cannot
 * answer, kept beside the others in `surface.ts` and typed against the router the same way.
 *
 * Its own module because `surface.ts` is long enough already; the rules it states are the same
 * kind: total over the router's mutations, so a new one is a `tsc` error until someone decides,
 * and a renamed input field is one too.
 */

import type { EventAction } from "../services/audit.ts";
import type { InputOf, MutationPath, ProcedurePath } from "./surface.ts";

/** The top-level fields of a procedure's input, the only thing a router-written row may copy. */
type InputField<P extends ProcedurePath> =
  InputOf<P> extends object ? keyof InputOf<P> & string : never;

/**
 * Who writes a mutation's audit row when it takes effect (ADR 0112):
 *
 * - `service`: its service, which alone knows what changed -- the role held before, the old name.
 * - `{ fields }`: the router, copying these fields of the input. The fields are typed against
 *   the input, so a renamed field is a `tsc` error; a field that is customer data or a secret
 *   simply is not named.
 * - `none`: nobody. A POST that changes nothing -- a check, an answer, a lake query -- is not an
 *   action, and logging it would bury the actions in reads.
 *
 * An attempt that is refused or fails is recorded by the router for every entry but `none`.
 */
export type AuditBy<P extends MutationPath> =
  | "service"
  | "none"
  | { readonly fields: readonly InputField<P>[] };

/** Total over mutations, as `EFFECTS` is: a new mutation is a `tsc` error until somebody decides. */
export type AuditTable = { readonly [P in MutationPath]: AuditBy<P> };

export const AUDITED: AuditTable = {
  // Ending a session is an action a person can be asked about, though its effect is a read.
  "session.signOut": { fields: [] },
  "session.setLocale": { fields: ["locale"] },

  "tenants.create": "service",
  "tenants.rename": "service",
  "tenants.deactivate": "service",
  "tenants.reactivate": "service",

  // Starting a consent records nothing anywhere else; finishing one is `connections.connected`.
  "connections.startOAuth": { fields: ["source", "addAccount"] },
  "connections.setScope": "service",
  "connections.setToken": "service",
  "connections.setCadence": "service",
  "connections.setResync": "service",
  "connections.disconnect": "service",

  "keys.mint": "service",
  "keys.revoke": "service",

  "people.invite": "service",
  "people.revokeInvitation": { fields: ["id"] },
  "people.setRole": "service",
  "people.removeMember": "service",

  // A read of the raw lake, however it is sent. The SQL is an admin's and may quote customer data.
  "lake.query": "none",

  "models.check": "none",
  "models.save": "service",
  "models.build": "service",
  "models.delete": "service",
  "models.setContext": "service",

  "macros.check": "none",
  "macros.save": "service",
  "macros.delete": "service",

  "documentKinds.add": "service",
  "documentKinds.update": "service",
  "documentKinds.remove": "service",
  "documentKinds.publish": "service",
  "documentKinds.initialise": "service",

  "bi.answer": "none",
  "bi.runQuestion": "none",
  "bi.questions.save": "service",
  "bi.questions.delete": "service",
  "bi.dashboards.save": "service",
  "bi.dashboards.delete": "service",
  // Asking for an export is recorded; so is taking it, by the download route.
  "bi.exports.create": "service",

  "runs.trigger": "service",

  "account.tokens.mint": "service",
  "account.tokens.revoke": "service",
  "account.apps.revoke": "service",
};

/** A mutation's entry as the middleware reads it, off a path it holds as a string. */
export type AuditRule = "service" | "none" | { readonly fields: readonly string[] };

const AUDIT_RULES: ReadonlyMap<string, AuditRule> = new Map(Object.entries(AUDITED));

/**
 * Who records a mutation, or `null` for a path that is not one. For a real mutation the type of
 * `AUDITED` makes `null` unreachable; the middleware records a refusal of it anyway.
 */
export function auditRuleOf(path: string): AuditRule | null {
  return AUDIT_RULES.get(path) ?? null;
}

/**
 * Every action a row can name: a mutation, or an event that reaches the log through no
 * procedure. What the browser labels, so a new one is a `tsc` error in its catalogue.
 */
export type AuditAction = MutationPath | EventAction;
