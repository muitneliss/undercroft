/**
 * The document-kind catalogue's page address and its one figure. ADR 0085.
 *
 * `sampleShare` arrives as the database's `numeric` text ("0.3867"), and is shown as a percent
 * to one place through `big.js` rather than parsed: it is a ratio, not money, but the repo-wide
 * ban on `Number()` does not ask which, and a string shifted two places is exact anyway.
 */

import Big from "big.js";

/** Where the catalogue opens for a tenant: a page of the lake division, as the console is. */
export function kindsPath(tenantId: string): string {
  return `/tenants/${tenantId}/lake/kinds`;
}

/** "0.3867" as "38.7%"; null when the kind was not seen in the sample, or is unreadable. */
export function sharePercent(share: string | null): string | null {
  if (share === null) {
    return null;
  }
  try {
    return `${new Big(share).times(100).toFixed(1)}%`;
  } catch {
    return null;
  }
}
