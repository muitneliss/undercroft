/**
 * The one hand-written table in the CLI: what each mutation DOES to the platform.
 *
 * Everything else about a command is read off the router (`manifest.ts`). This cannot be,
 * because tRPC's query/mutation split is about HTTP -- a mutation is a POST -- and not about
 * consequences: `bi.answer` is a mutation that reads, and deleting a dashboard is a mutation
 * too. The CLI's safety rules turn on consequences, so somebody has to write them down.
 *
 * - `read` goes through on any profile.
 * - `write` needs the profile's `allowWrites`, which only a person at a terminal can set.
 * - `destructive` needs that AND, in agent mode, an explicit `--yes`.
 *
 * A query is `read` unless it is listed. Every mutation MUST be listed: the build refuses a
 * mutation that is not, and an entry naming a path the router does not have
 * (`scripts/build.ts`). A new mutation therefore cannot ship as a read by default -- which is
 * the failure that would matter, since it would reach a production profile unguarded.
 */

export type Effect = "read" | "write" | "destructive";

export const EFFECTS: Readonly<Record<string, Effect>> = {
  // Signing out can only take authority away, and gating it would leave a person unable to
  // end a session on the very profile that forbids writes.
  "session.signOut": "read",
  "session.setLocale": "write",

  "tenants.create": "write",
  "tenants.rename": "write",

  // `startOAuth` records a handshake and returns a consent URL; the person opens it.
  "connections.startOAuth": "write",
  "connections.setScope": "write",
  "connections.setToken": "write",
  "connections.setCadence": "write",
  "connections.disconnect": "destructive",

  "keys.mint": "write",
  "keys.revoke": "destructive",

  "people.invite": "write",
  "people.revokeInvitation": "destructive",
  // A role change is undone by another; a removal is undone only by a fresh invitation,
  // which the person has to accept.
  "people.setRole": "write",
  "people.removeMember": "destructive",

  // Reads nothing it could not read anyway, but it runs SQL an admin wrote against the raw
  // lake, which ADR 0029 kept away from the assistant for the same reason. Here it takes the
  // same per-profile opt-in a write does.
  "lake.query": "write",

  "models.save": "write",
  "models.build": "write",
  "models.delete": "destructive",

  // Both are POSTs because a question definition does not fit a query string. They answer a
  // definition the BI role compiles; neither changes anything.
  "bi.answer": "read",
  "bi.runQuestion": "read",
  "bi.questions.save": "write",
  "bi.questions.delete": "destructive",
  "bi.dashboards.save": "write",
  "bi.dashboards.delete": "destructive",

  "runs.trigger": "write",
};

/** A procedure's effect, or `null` for a mutation nobody classified (the build refuses it). */
export function effectOf(spec: { readonly path: string; readonly type: string }): Effect | null {
  const listed = EFFECTS[spec.path];
  if (listed !== undefined) {
    return listed;
  }
  return spec.type === "query" ? "read" : null;
}
