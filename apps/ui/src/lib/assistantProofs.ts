/**
 * Which action prints which sentence, and which ones need more than a click.
 *
 * The browser cannot import the server's catalogue -- `.biome/plugins/ui-server-import.grit`
 * allows a TYPE from `@undercroft/control-plane` and nothing else, and it is right to: the
 * catalogue pulls in zod, the tRPC router and the Anthropic provider. So the two facts the
 * panel needs about a mutation are restated here, and a server-side test asserts the two lists
 * agree rather than trusting that they do.
 *
 * That is a deliberate duplication with a gate on it, which is the only kind worth having. The
 * alternative was sending the proof sentence down with the tool call, and that is worse for the
 * reason `Proof.tsx` gives: the sentence a reader strikes must not come from the same place as
 * the proposal.
 */

import type { TFunction } from "i18next";

/**
 * One argument, or an empty string.
 *
 * A function of its own so no case below repeats a `?? ""` -- seven of them pushed
 * `proofSentence` past the complexity gate, and an absent argument has one right answer
 * anyway. An empty string leaves a visible gap in the sentence; the word `undefined` in it
 * would just confuse a reader who is about to strike something.
 */
function pick(values: Record<string, string>, name: string): string {
  return values[name] ?? "";
}

/**
 * The sentence a proof prints, or `null` for a tool that declares none.
 *
 * A SWITCH on literal keys rather than a lookup table of key strings, and that is not
 * verbosity for its own sake. The i18n catalogue is typed, so `t` refuses a key it cannot see
 * -- which means a table of `string` keys cannot be passed to it at all without giving up the
 * typing that makes a misspelt key a compile error. Writing the call out per tool also puts
 * each sentence's REQUIRED ARGUMENTS beside it, so a tool whose input shape changes produces a
 * type error rather than a sentence with a blank in the middle of it.
 *
 * `null` rather than a fallback sentence: the caller says what it would have run, and
 * `catalogue.test.ts` fails on a mutating tool with no `proofKey`, so this should be
 * unreachable for a mutation.
 */
export function proofSentence(t: TFunction, tool: string, input: unknown): string | null {
  const values = proofValues(input);
  switch (tool) {
    case "runIngestNow":
      return t("assistant.proof.runIngestNow", {
        source: pick(values, "source"),
        tenantId: pick(values, "tenantId"),
      });
    case "setCadence":
      return t("assistant.proof.setCadence", {
        source: pick(values, "source"),
        cadence: pick(values, "cadence"),
      });
    case "invitePerson":
      return t("assistant.proof.invitePerson", {
        email: pick(values, "email"),
        tenantId: pick(values, "tenantId"),
        role: pick(values, "role"),
      });
    case "revokeGrant":
      return t("assistant.proof.revokeGrant", {
        source: pick(values, "source"),
        tenantId: pick(values, "tenantId"),
      });
    case "withdrawIngestKey":
      return t("assistant.proof.withdrawIngestKey", {
        id: pick(values, "id"),
        tenantId: pick(values, "tenantId"),
      });
    case "revokeInvitation":
      return t("assistant.proof.revokeInvitation", {
        id: pick(values, "id"),
        tenantId: pick(values, "tenantId"),
      });
    case "deleteModel":
      return t("assistant.proof.deleteModel", {
        name: pick(values, "name"),
        tenantId: pick(values, "tenantId"),
      });
    default:
      return null;
  }
}

/**
 * The privileged tier, and WHICH ARGUMENT the reader has to type back.
 *
 * A one-click strike is right for an action whose worst case is that it happens twice. It is
 * wrong for one whose blast radius is a customer's data, where the reader has to demonstrate
 * they read which object rather than that they found a button -- so they retype the argument
 * the action turns on.
 *
 * NOT here, and not anywhere: authoring or building a dbt model, and running SQL in the lake
 * console. Writing SQL that will run as the customer's own database role is not a thing to do
 * by description -- an author has to see what they wrote before it runs -- so those stay in
 * their own divisions, and the `navigate` tier is how the assistant takes a reader there.
 */
export const PRIVILEGED_TOOLS: Readonly<Record<string, string>> = {
  // The argument each one turns on, which is what the reader retypes. `source` rather than
  // `tenantId` for a grant: the customer is already on screen in the running head, and the
  // thing a reader could get wrong is WHICH source they are cutting off.
  revokeGrant: "source",
  withdrawIngestKey: "id",
  revokeInvitation: "id",
  deleteModel: "name",
};

/**
 * A tool's arguments as i18next interpolation values.
 *
 * Everything becomes a string here rather than being passed through: an argument is printed
 * into a sentence, and a number formatted by `toString` in a sentence is a different thing from
 * a count formatted through the reader's locale -- which is `formatCount`'s job, not a proof's.
 */
export function proofValues(input: unknown): Record<string, string> {
  if (input === null || typeof input !== "object") {
    return {};
  }
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    values[name] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return values;
}
