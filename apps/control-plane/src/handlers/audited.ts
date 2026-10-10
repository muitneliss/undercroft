/**
 * Who writes each mutation's audit row (ADR 0113), and which calls are reads (ADR 0120): facts
 * about a procedure the router cannot answer, kept beside the others in `surface.ts` and typed
 * against the router the same way.
 *
 * Its own module because `surface.ts` is long enough already; the rules it states are the same
 * kind: total over the router's mutations, so a new one is a `tsc` error until someone decides,
 * and a renamed input field is one too.
 */

import type { AuditDetail, Channel, EventAction } from "../services/audit.ts";
import type { InputOf, MutationPath, ProcedurePath } from "./surface.ts";

/** The top-level fields of a procedure's input, the only thing a router-written row may copy. */
type InputField<P extends ProcedurePath> =
  InputOf<P> extends object ? keyof InputOf<P> & string : never;

/**
 * Who writes a mutation's audit row when it takes effect (ADR 0113):
 *
 * - `service`: its service, which alone knows what changed -- the role held before, the old name.
 * - `{ fields }`: the router, copying these fields of the input. The fields are typed against
 *   the input, so a renamed field is a `tsc` error; a field that is customer data or a secret
 *   simply is not named.
 * - `read`: a POST that changes nothing -- a check, an answer, a lake query -- which is recorded
 *   exactly as a query is: through an agent's door, with nothing of its input but the tenant it
 *   named, and not at all through the browser's (ADR 0120).
 *
 * An attempt that is refused or fails is recorded by the router for every entry but `read`, and
 * for `read` through every door but the browser's.
 */
export type AuditBy<P extends MutationPath> =
  | "service"
  | "read"
  | { readonly fields: readonly InputField<P>[] };

/** Total over mutations, as `EFFECTS` is: a new mutation is a `tsc` error until somebody decides. */
export type AuditTable = { readonly [P in MutationPath]: AuditBy<P> };

export const AUDITED: AuditTable = {
  // Ending a session is recorded by whatever ends it: Better Auth's session hook writes
  // `auth.signOut` (`authAudit.ts`), for this procedure and Better Auth's own `/sign-out` alike, so
  // one sign-out is one row. The router still records a refused or failed attempt.
  "session.signOut": "service",
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

  // A read of the raw lake, however it is sent. The SQL is an admin's and may quote customer data,
  // which is why a read copies none of its input.
  "lake.query": "read",

  "models.check": "read",
  "models.save": "service",
  "models.build": "service",
  "models.delete": "service",

  "macros.check": "read",
  "macros.save": "service",
  "macros.delete": "service",

  "documentKinds.add": "service",
  "documentKinds.update": "service",
  "documentKinds.remove": "service",
  "documentKinds.publish": "service",
  "documentKinds.initialise": "service",

  "bi.answer": "read",
  "bi.runQuestion": "read",
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

/** A call's entry as the middleware reads it, off a path it holds as a string. */
export type AuditRule = "service" | "read" | { readonly fields: readonly string[] };

const AUDIT_RULES: ReadonlyMap<string, AuditRule> = new Map(Object.entries(AUDITED));

/**
 * Who records a call. A query is a read. A mutation is its `AUDITED` entry; one missing there,
 * which the type of `AUDITED` makes unreachable, is recorded by nobody on success and by the
 * router when it is refused -- the direction that leaves a trace.
 */
export function auditRuleOf(path: string, type: "query" | "mutation" | "subscription"): AuditRule {
  return type === "mutation" ? (AUDIT_RULES.get(path) ?? "service") : "read";
}

/** A field of a call's raw input, if the input is an object that has it. */
function field(raw: unknown, name: string): unknown {
  return typeof raw === "object" && raw !== null && Object.hasOwn(raw, name)
    ? Reflect.get(raw, name)
    : undefined;
}

/** The fields a router-written row copies, kept only where they are a plain value. */
export function detailOf(rule: Exclude<AuditRule, "service" | "read">, raw: unknown): AuditDetail {
  const detail: Record<string, string | number | boolean | null> = {};
  for (const name of rule.fields) {
    const value = field(raw, name);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      detail[name] = value;
    }
  }
  return detail;
}

/** The tenant a call named, off its raw input: the one place every tenant procedure puts it. */
export function namedTenant(raw: unknown): string | null {
  const value = field(raw, "tenantId");
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Whether a call leaves a row at all, before who writes it is asked.
 *
 * Every action does. A read does through an agent's door -- the CLI, `/mcp`, the assistant --
 * because what an agent read of a customer's data on a person's authority is what a person asks
 * of this log. A read through the browser does not: every page polls, and its reads would bury
 * the actions they sit beside (ADR 0113's reason, kept for that door alone by ADR 0120).
 */
export function isRecorded(rule: AuditRule, channel: Channel): boolean {
  return rule !== "read" || channel !== "web";
}

/**
 * Every action a row can name: a procedure -- a read through an agent's door is one too -- or an
 * event that reaches the log through no procedure. What the browser labels, so a new one is a
 * `tsc` error in its catalogue.
 */
export type AuditAction = ProcedurePath | EventAction;
