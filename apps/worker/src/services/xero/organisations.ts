/**
 * The organisations one Xero consent can see.
 *
 * An accountant's Xero login sees every client's books, and a consent granted from it
 * covers all of them. The platform must be told which one a customer means -- sending our
 * tenant id, or the first one in the list, is the defect that meant live Xero had never run
 * against the right organisation -- so this lists them for the admin to choose from, in the
 * same shape the Gmail label listing takes.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import type { ByteFetcher } from "@undercroft/core";
import { raiseForByteStatus } from "@undercroft/core";

export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

export interface XeroOrganisation {
  /** Xero's tenant id: the value of the `xero-tenant-id` header. Opaque, never a name. */
  readonly id: string;
  readonly name: string;
  /** The same three-valued field the label listing carries; Xero has no such distinction. */
  readonly kind: null;
}

export interface OrganisationsDeps {
  readonly fetcher: ByteFetcher;
  /** A property, not a method: it is passed by reference, and a method would carry `this`. */
  readonly token: () => Promise<string>;
  readonly connectionsUrl?: string;
}

interface ConnectionRow {
  readonly tenantId?: unknown;
  readonly tenantName?: unknown;
}

export async function listOrganisations(deps: OrganisationsDeps): Promise<XeroOrganisation[]> {
  const request = {
    url: deps.connectionsUrl ?? XERO_CONNECTIONS_URL,
    method: "GET" as const,
    headers: { authorization: `Bearer ${await deps.token()}`, accept: "application/json" },
  };
  const response = await deps.fetcher.send(request);
  raiseForByteStatus(request, response);

  const body = JSON.parse(new TextDecoder().decode(response.bytes)) as unknown;
  if (!Array.isArray(body)) {
    return [];
  }
  return (body as ConnectionRow[]).flatMap((row) => {
    const id = typeof row.tenantId === "string" ? row.tenantId : "";
    if (id === "") {
      return [];
    }
    const name = typeof row.tenantName === "string" ? row.tenantName : "";
    return [{ id, name: name === "" ? id : name, kind: null }];
  });
}
