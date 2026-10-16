/**
 * "What can this person see": a role's, a member's or the caller's own reach resolved against what
 * the customer has, with the rules on each model and whether any of them is broken (ADR 0143).
 *
 * `grants.reach` answers what Casbin DECIDED -- `models: "all"`, or the named models, with their
 * limits. This answers what that comes to: every model and reference table the subject reads, by
 * name, each with the rows it shows (`null` for every row), the columns it hides, and, for a row
 * rule that no longer compiles against the table standing now, why -- the database showing that
 * login no row of it, which an administrator must hear about rather than discover. It is the
 * question to ask before a grant and after it, and the summary the access view prints.
 *
 * Who may ask is `grants.reach`'s rule: about oneself, any member; about a role or another person,
 * a holder of `people:manage`, because who reads what is the roster's information (ADR 0119). The
 * handler decides that; this decides nothing about who is asking.
 */

import { type Permission, type Reach, limitOf, reachesModel } from "@undercroft/contracts/access";
import type { RowRule } from "@undercroft/contracts/rowRules";
import type { SqlExecutor } from "@undercroft/db";
import { listModels, listSeedSummaries } from "@undercroft/db/repos";

import { type RuleFault, type RuleFaultKind, ruleFaults } from "../repos/scopeFaults.ts";
import type { Holding } from "./authz.ts";
import { holdingFor, type NamedSubject } from "./grantSubjects.ts";

/** One model or reference table the subject reads, and how much of it. */
export interface PreviewModel {
  readonly name: string;
  readonly kind: "model" | "seed";
  /** The rows they see: `null` for every row, else rows meeting any one of these rules. */
  readonly rows: readonly RowRule[] | null;
  /** The columns they may not read. A column a later build adds is visible until hidden. */
  readonly hidden: readonly string[];
  /** Why the row rule is broken -- they then see no row of it -- or `null` when it holds. */
  readonly broken: {
    readonly fault: RuleFaultKind;
    readonly columns: readonly string[];
  } | null;
}

/** What a subject can see, resolved: their permissions, and every thing they read. */
export interface ScopePreview {
  readonly permissions: readonly Permission[];
  readonly models: {
    /** Whether they read every model and reference table whole (`model:*`). */
    readonly whole: boolean;
    /** How many models and reference tables the customer has. */
    readonly total: number;
    readonly reached: readonly PreviewModel[];
  };
  readonly raw: Reach["raw"];
  readonly reports: Reach["reports"];
}

export type PreviewOutcome =
  | { readonly ok: true; readonly preview: ScopePreview }
  | { readonly ok: false; readonly reason: "one-subject" | "no-such-role" | "not-member" };

function previewModel(
  name: string,
  kind: PreviewModel["kind"],
  reach: Reach,
  faults: readonly RuleFault[],
): PreviewModel {
  const limit = limitOf(reach, name);
  const fault = faults.find((found) => found.model === name);
  return {
    name,
    kind,
    rows: limit?.rows ?? null,
    hidden: limit?.hidden ?? [],
    broken: fault === undefined ? null : { fault: fault.fault, columns: fault.columns },
  };
}

/** What a role, a member, or -- naming nobody -- the caller can see in their customer. */
export async function preview(
  exec: SqlExecutor,
  input: NamedSubject & { readonly tenantId: string; readonly caller: Holding },
): Promise<PreviewOutcome> {
  const held = await holdingFor(exec, input);
  if (!held.ok) {
    return held;
  }
  const { reach, permissions } = held.holding;
  const [models, seeds, faults] = await Promise.all([
    listModels(exec, input.tenantId),
    listSeedSummaries(exec, input.tenantId),
    ruleFaults(exec, input.tenantId, reach.limits ?? []),
  ]);
  const all = [
    ...models.map((model) => ({ name: model.name, kind: "model" as const })),
    ...seeds.map((seed) => ({ name: seed.name, kind: "seed" as const })),
  ].sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    ok: true,
    preview: {
      permissions,
      models: {
        whole: reach.models === "all",
        total: all.length,
        reached: all
          .filter((thing) => reachesModel(reach, thing.name))
          .map((thing) => previewModel(thing.name, thing.kind, reach, faults)),
      },
      raw: reach.raw,
      reports: reach.reports,
    },
  };
}
