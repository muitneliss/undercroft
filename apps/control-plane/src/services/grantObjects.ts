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
import { type GrantRules, narrowingOf, type RowRule } from "@undercroft/contracts/rowRules";
import type { SqlExecutor } from "@undercroft/db";
import { columnsOfModel, objectExists, type StoredRules } from "../repos/accessGrants.ts";
import { type Beyond, type Holding, lacking } from "./authz.ts";
import { objectOf, permissionOfObject } from "./rbac.ts";

/** What a request grants: one permission, or reading one object -- exactly one. */
export interface NamedGrant {
  readonly permission?: Permission | undefined;
  /** An object of the reach grammar; anything else is refused as naming nothing. */
  readonly object?: string | undefined;
  /** A row rule, on a grant of one model only (ADR 0143). */
  readonly rowRule?: RowRule | undefined;
  /** Columns to hide, on a grant of one model only. */
  readonly hiddenColumns?: readonly string[] | undefined;
}

/**
 * A grant as it will be stored: its object and action, the object read for an object grant, and a
 * model grant's rules -- `null` when it has none, which is a grant of the whole model.
 */
export type Granted =
  | {
      readonly ok: true;
      readonly object: string;
      readonly action: string;
      readonly reach: ReachObject | null;
      readonly rules: GrantRules | null;
    }
  | {
      readonly ok: false;
      /** `rules-need-one-model`: a rule on a permission, a wildcard, a stream or a report. */
      readonly reason: "one-object" | "unknown-object" | "rules-need-one-model" | "eq-one-value";
    };

/**
 * A model grant's rules as they are stored: each condition's values without repeats, in the order
 * written; hidden columns once each, sorted; `null` for a grant that names neither. An `eq` with
 * more than one value is refused rather than read as `in`, because the person who wrote it meant
 * something else.
 */
function rulesOf(named: NamedGrant): GrantRules | null | "eq-one-value" {
  const rows =
    named.rowRule === undefined || named.rowRule.length === 0
      ? null
      : named.rowRule.map((condition) => ({
          ...condition,
          values: [...new Set(condition.values)],
        }));
  if (rows?.some((condition) => condition.op === "eq" && condition.values.length !== 1)) {
    return "eq-one-value";
  }
  const hidden = [...new Set(named.hiddenColumns ?? [])].sort();
  return rows === null && hidden.length === 0 ? null : { rows, hidden };
}

export function grantedBy(named: NamedGrant): Granted {
  if ((named.permission === undefined) === (named.object === undefined)) {
    return { ok: false, reason: "one-object" };
  }
  const rules = rulesOf(named);
  if (rules === "eq-one-value") {
    return { ok: false, reason: "eq-one-value" };
  }
  if (named.permission !== undefined) {
    return rules === null
      ? { ok: true, object: objectOf(named.permission), action: USE_ACTION, reach: null, rules }
      : { ok: false, reason: "rules-need-one-model" };
  }
  const reach = parseReachObject(named.object ?? "");
  if (reach === null) {
    return { ok: false, reason: "unknown-object" };
  }
  // A rule names one model's columns: `model:*` has none, and neither has a stream or a report.
  if (rules !== null && !(reach.domain === "model" && reach.name !== null)) {
    return { ok: false, reason: "rules-need-one-model" };
  }
  return { ok: true, object: reachObjectText(reach), action: READ_ACTION, reach, rules };
}

/** A grant's rules as the two columns store them. */
export function storedRules(rules: GrantRules | null): StoredRules {
  return {
    rowRule: rules?.rows ?? null,
    hiddenColumns: rules === null || rules.hidden.length === 0 ? null : rules.hidden,
  };
}

/** The rules of a stored grant, as a grant names them: `null` for one of the whole model. */
export function rulesStored(stored: StoredRules): GrantRules | null {
  return stored.rowRule === null && stored.hiddenColumns === null
    ? null
    : { rows: stored.rowRule, hidden: stored.hiddenColumns ?? [] };
}

/**
 * What the caller would need to give or take away `object` as stored, with its rules, beyond what
 * they hold: the permission it names, or the object itself -- and for one model, at least as much
 * of it as the rules give (ADR 0143). An object neither the catalogue nor the grammar knows holds
 * nothing, and may be removed by anyone who may remove grants at all.
 */
export function beyondFor(held: Holding, object: string, rules: GrantRules | null = null): Beyond {
  const permission = permissionOfObject(object);
  if (permission !== null) {
    return { permissions: lacking(held.permissions, [permission]), objects: [] };
  }
  const reach = parseReachObject(object);
  return {
    permissions: [],
    objects: reach === null || covers(held.reach, reach, narrowingOf(rules)) ? [] : [object],
  };
}

/**
 * The columns a model grant's rules name that the model does not have, as its last build found
 * them: `null` when every one is known. A hidden column is weighed as much as a row rule's: a
 * name that matches nothing would hide nothing, and the person who wrote it would believe it did.
 */
export async function unknownColumns(
  exec: SqlExecutor,
  tenantId: string,
  granted: { readonly reach: ReachObject | null; readonly rules: GrantRules | null },
): Promise<{
  readonly model: string;
  readonly unknown: readonly string[];
  readonly known: readonly string[];
} | null> {
  const { rules, reach } = granted;
  const model = reach?.domain === "model" ? reach.name : null;
  if (rules === null || model === null) {
    return null;
  }
  const known = (await columnsOfModel(exec, tenantId, model)) ?? [];
  const named = [...(rules.rows ?? []).map((condition) => condition.column), ...rules.hidden];
  const unknown = [...new Set(named)].filter((column) => !known.includes(column));
  return unknown.length === 0 ? null : { model, unknown, known };
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
