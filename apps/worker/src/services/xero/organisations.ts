/**
 * The organisations one Xero consent can see.
 *
 * An accountant's Xero login sees every client's books, and a consent granted from it
 * covers all of them. The platform must be told which one a customer means -- sending our
 * tenant id, or the first one in the list, is the defect that meant live Xero had never run
 * against the right organisation -- so this lists them for the admin to choose from, in the
 * same shape the Gmail label listing takes.
 */

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
