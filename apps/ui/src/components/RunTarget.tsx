/**
 * The doors from a run to what it acted on: the account an ingest read, or the model a one-model
 * build built (`runTarget` in `@/lib/runs` decides which, and when there is none to name).
 *
 * Its own module because `RunDetail` is the ledger's record of a run and these are the ways out
 * of it; both halves are drawn on the run's leaf, one in its fact row and one at its foot, and
 * both follow the same target, so they are written beside each other rather than apart.
 */

import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { divisionPath } from "@/lib/divisions.ts";
import { lineagePath } from "@/lib/lineage.ts";
import { MISSING } from "@/lib/money.ts";
import {
  type AccountName,
  journalPath,
  journalSource,
  type RunTarget,
  sourceLabel,
} from "@/lib/runs.ts";
import { useUiStore } from "@/store.ts";

/** Where a model's editor opens: the models division, then the model's name as its segment. */
function modelPath(tenantId: string, name: string): string {
  return `${divisionPath("models", tenantId)}/${name}`;
}

/**
 * What the run acted on, as the datum of its fact and a door to it.
 *
 * An account opens the Sources leaf, and first chooses that account in the store: a kind with
 * two mailboxes shows the first one by default, and landing on the other account's card would
 * put the wrong mailbox beside this run. A build that recorded no model step is MISSING.
 */
export function TargetDoor({
  target,
  tenantId,
  accounts,
}: {
  target: RunTarget;
  tenantId: string;
  /** The tenant's connections, so the account names which mailbox of two (`sourceLabel`). */
  accounts: readonly AccountName[];
}): React.ReactNode {
  const selectAccount = useUiStore((state) => state.selectAccount);

  if (target.kind === "model") {
    return target.name === null ? (
      MISSING
    ) : (
      <Link to={modelPath(tenantId, target.name)}>{target.name}</Link>
    );
  }
  return (
    <Link
      to={divisionPath("sources", tenantId)}
      onClick={(): void => {
        selectAccount(tenantId, target.sourceKind, target.source);
      }}
    >
      {sourceLabel(target.source, accounts)}
    </Link>
  );
}

/**
 * The ways on from a run, at the foot of its leaf: the account's other runs, or the model's
 * declared upstream. The target itself is not repeated here; its fact is its door.
 *
 * "Other runs" keeps this run open, so narrowing the ledger costs the reader nothing else --
 * the reverse of `journal.showAllRuns` -- and is not offered on a ledger already narrowed to
 * this account, where it would be a plate that leads back to the page it is on.
 */
export function RunDoors({
  target,
  tenantId,
  runId,
}: {
  target: RunTarget | null;
  tenantId: string;
  runId: string;
}): React.ReactNode {
  const { t } = useTranslation();
  const [search] = useSearchParams();

  if (target?.kind === "source" && journalSource(search) !== target.source) {
    return (
      <div className="row">
        <Link className="plate" to={journalPath(tenantId, { source: target.source, runId })}>
          {t("journal.otherRuns")}
        </Link>
      </div>
    );
  }
  if (target?.kind === "model" && target.name !== null) {
    return (
      <div className="row">
        <Link className="plate" to={lineagePath(tenantId, target.name)}>
          {t("journal.inspectUpstream")}
        </Link>
      </div>
    );
  }
  return null;
}
