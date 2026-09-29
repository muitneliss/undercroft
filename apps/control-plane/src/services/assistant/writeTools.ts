/**
 * The two tiers that change something: `write`, pulled as a proof the reader strikes, and
 * `privileged`, a proof and a typed confirmation of the object's name.
 *
 * Split from `catalogue.ts`, which had grown past what one file may be, and joined back into
 * `CATALOGUE` there. Everything the catalogue's docstring says about a declaration with no
 * `execute`, and descriptions written in English for the model, holds here unchanged.
 */

import { z } from "zod";

import { CadenceChoice, ResyncChoice } from "./cadenceChoice.ts";
import { ConnectionSource } from "./connectionSource.ts";
import { inTenant, type ToolSpec } from "./toolSpec.ts";

/**
 * The write tier: reversible, cheap, and pulled as a proof the reader must strike.
 *
 * Every one of these is something an admin could already do in two clicks, and every one is
 * reversible in the same two -- a cadence can be set back, a run can be triggered again, an
 * invitation can be revoked. That is what makes them the routine tier: the cost of a wrong one
 * is a minute, not a customer's data.
 *
 * Each carries a `proofKey`. The sentence the reader strikes comes from the i18n catalogue
 * under that key, interpolated with the real arguments -- never from the model, which would be
 * asking the thing proposing the action to also word the confirmation of it.
 */
export const WRITE_TOOLS = {
  runIngestNow: {
    description:
      "Start an ingest run for one source of one customer, now, instead of waiting for its " +
      "cadence. Use when the reader wants fresh data immediately.",
    inputSchema: inTenant.extend({
      source: ConnectionSource,
    }),
    tier: "write",
    plate: "runs",
    procedure: "runs.trigger",
    proofKey: "assistant.proof.runIngestNow",
  },
  setCadence: {
    description:
      "Change how often one source is ingested: a preset, or custom with a cron expression. This " +
      "is reversible; the previous cadence is not remembered, so name the new one plainly.",
    inputSchema: inTenant.extend({
      source: ConnectionSource,
      ...CadenceChoice,
    }),
    tier: "write",
    plate: "grants",
    procedure: "connections.setCadence",
    proofKey: "assistant.proof.setCadence",
  },
  setResync: {
    description:
      "Change how often one source's lists are read in full again, to catch edits its change " +
      "filter never reports (Xero's due dates and contact balances). Off until turned on. A full " +
      "read spends at most the provider's daily share of requests and continues on later runs, " +
      "so a large organisation's re-sync can take days. Refused for a source with nothing to " +
      "re-sync, such as HubSpot.",
    inputSchema: inTenant.extend({
      source: ConnectionSource,
      ...ResyncChoice,
    }),
    tier: "write",
    plate: "grants",
    procedure: "connections.setResync",
    proofKey: "assistant.proof.setResync",
  },
  invitePerson: {
    description:
      "Invite somebody to this customer by email address, at a role. viewer reads, member also " +
      "authors questions, admin also connects accounts. Sign-in is invitation-only, so this is " +
      "the only way somebody gains access.",
    inputSchema: inTenant.extend({
      email: z.string().email(),
      role: z.enum(["viewer", "member", "admin"]),
    }),
    tier: "write",
    plate: "facts",
    procedure: "people.invite",
    proofKey: "assistant.proof.invitePerson",
  },
} as const satisfies Record<string, ToolSpec>;

/**
 * The privileged tier: none of reversible, cheap, or small in blast radius.
 *
 * Each of these takes something away, and what it takes away belongs to a customer. Revoking a
 * grant stops a source and needs a human at Google to restore. Withdrawing an ingest key breaks
 * whatever was posting with it, silently, until somebody notices. Deleting a model deletes SQL
 * the customer wrote.
 *
 * So each is a proof AND a typed confirmation of the object's name -- see `PRIVILEGED_TOOLS` in
 * `apps/ui/src/lib/assistantProofs.ts` for which argument the reader retypes. A one-click
 * strike is right for an action whose worst case is that it happens twice; it is wrong for one
 * where the reader must demonstrate they read WHICH object rather than that they found a button.
 *
 * WHAT IS DELIBERATELY ABSENT. `models.save` and `models.build` are not here and not anywhere:
 * authoring SQL that will run as the customer's own database role is not a thing to do by
 * description, and `lake.query` is the same hazard with a shorter fuse. Both stay in the
 * Models division and the Lake Console, where an author sees what they wrote before it runs --
 * and the assistant's `navigate` tier is how it takes them there. `people.setRole` and
 * `people.removeMember` are absent too, for now: they change who may read a customer's books,
 * and giving them to the assistant is a decision to review on its own rather than something
 * to add alongside the procedures. Until then a membership is changed in the People division
 * or from the CLI.
 */
export const PRIVILEGED_WRITE_TOOLS = {
  revokeGrant: {
    description:
      "Disconnect one source for a customer, revoking the stored credential. Ingestion for " +
      "that source stops until somebody reconnects it, which requires the account holder.",
    inputSchema: inTenant.extend({
      source: ConnectionSource,
    }),
    tier: "privileged",
    plate: "grants",
    procedure: "connections.disconnect",
    proofKey: "assistant.proof.revokeGrant",
  },
  withdrawIngestKey: {
    description:
      "Revoke one ingest key by id. Anything posting to the lake API with that key stops " +
      "being accepted immediately, and will not be told why.",
    inputSchema: inTenant.extend({ id: z.string().min(1) }),
    tier: "privileged",
    plate: "facts",
    procedure: "keys.revoke",
    proofKey: "assistant.proof.withdrawIngestKey",
  },
  revokeInvitation: {
    description:
      "Withdraw an open invitation by id, so that address can no longer sign in. Use when an " +
      "invitation went to the wrong person.",
    inputSchema: inTenant.extend({ id: z.string().uuid() }),
    tier: "privileged",
    plate: "facts",
    procedure: "people.revokeInvitation",
    proofKey: "assistant.proof.revokeInvitation",
  },
  deleteModel: {
    description:
      "Delete one dbt model by name, with its SQL, the table it built and the rows its tests " +
      "stored. Refused, deleting nothing, while a build runs or another model reads its table.",
    inputSchema: inTenant.extend({ name: z.string().min(1) }),
    tier: "privileged",
    plate: "facts",
    procedure: "models.delete",
    proofKey: "assistant.proof.deleteModel",
  },
} as const satisfies Record<string, ToolSpec>;
