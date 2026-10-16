/**
 * What a grant gives: one permission (`perm:<permission>`, `use`) or reading one thing
 * (`model:fct_sales`, `raw:hubspot/deals`, `report:question:<uuid>`, or the whole of one, with
 * `read`) -- as a request names it, as it is stored, and what giving or taking it away needs.
 * ADR 0141, ADR 0142.
 *
 * Its own module beside `grants.ts`, which keeps WHO is granted and the writes: this keeps WHAT,
 * so the grammar's reading (`parseReachObject`), the canonical spelling a stored grant takes
 * (`reachObjectText`), the subset rule's question about one object and the "does it exist" check
 * are read in one place, and `grants.ts` asks them.
 */

import {
  covers,
  type Permission,
  parseReachObject,
  READ_ACTION,
  type ReachObject,
  reachObjectText,
  USE_ACTION,
} from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import { objectExists } from "../repos/accessGrants.ts";
import { type Beyond, type Holding, lacking } from "./authz.ts";
import { objectOf, permissionOfObject } from "./rbac.ts";

/** What a request grants: one permission, or reading one object -- exactly one. */
export interface NamedGrant {
  readonly permission?: Permission | undefined;
  /** An object of the reach grammar; anything else is refused as naming nothing. */
  readonly object?: string | undefined;
}

/** A grant as it will be stored: its object and action, and the object read, for an object grant. */
export type Granted =
  | {
      readonly ok: true;
      readonly object: string;
      readonly action: string;
      readonly reach: ReachObject | null;
    }
  | { readonly ok: false; readonly reason: "one-object" | "unknown-object" };

export function grantedBy(named: NamedGrant): Granted {
  if ((named.permission === undefined) === (named.object === undefined)) {
    return { ok: false, reason: "one-object" };
  }
  if (named.permission !== undefined) {
    return { ok: true, object: objectOf(named.permission), action: USE_ACTION, reach: null };
  }
  const reach = parseReachObject(named.object ?? "");
  return reach === null
    ? { ok: false, reason: "unknown-object" }
    : { ok: true, object: reachObjectText(reach), action: READ_ACTION, reach };
}

/**
 * What the caller would need to give or take away `object` as stored, beyond what they hold: the
 * permission it names, or the object itself. An object neither the catalogue nor the grammar
 * knows holds nothing, and may be removed by anyone who may remove grants at all.
 */
export function beyondFor(held: Holding, object: string): Beyond {
  const permission = permissionOfObject(object);
  if (permission !== null) {
    return { permissions: lacking(held.permissions, [permission]), objects: [] };
  }
  const reach = parseReachObject(object);
  return { permissions: [], objects: reach === null || covers(held.reach, reach) ? [] : [object] };
}

/** Does the customer have the one thing an object grant names? A wildcard or a stream needs nothing. */
export function exists(exec: SqlExecutor, tenantId: string, object: ReachObject): Promise<boolean> {
  if (object.domain === "model" && object.name !== null) {
    return objectExists(exec, tenantId, { model: object.name });
  }
  if (object.domain === "report" && object.report !== null) {
    return objectExists(exec, tenantId, object.report);
  }
  return Promise.resolve(true);
}
