/**
 * One row of the Models list: the model's name -- and that its draft is unsaved, when it is --
 * its last build, the run that made it and the columns that run found, and the state of its
 * business context (ADR 0105). Split out of `routes/Models.tsx`; the list decides which rows
 * show and in what order, and this decides nothing but how one reads.
 *
 * A model never built has no run and no known columns, and both print MISSING, never a zero
 * (`builtColumnCount` says why an empty list of columns is not "none").
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { ModelItem } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { buildMark, buildMarkLabel, builtColumnCount } from "@/lib/modelBuild.ts";
import { contextMark, contextStateLabel } from "@/lib/modelContext.ts";
import { formatCount, MISSING } from "@/lib/money.ts";
import { journalPath } from "@/lib/runs.ts";
import { relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";

/** One model's row: its name, its last build, what that made, and its context's state. */
export function ModelRow({
  tenantId,
  model,
  unsaved,
}: {
  tenantId: string;
  model: ModelItem;
  /** Its draft in the store differs from what was saved. */
  unsaved: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const columns = builtColumnCount(model.lastBuild);
  return (
    <tr>
      <td>
        <Link className="journal__what" to={`${divisionPath("models", tenantId)}/${model.name}`}>
          {model.name}
        </Link>
        {unsaved ? (
          <span className="datum datum--quiet journal__trigger">{t("models.unsaved")}</span>
        ) : null}
      </td>
      <td>
        <StatusMark
          mark={buildMark(model.lastBuild?.status ?? null)}
          label={buildMarkLabel(t, model.lastBuild?.status ?? null)}
        />
      </td>
      <td className="datum">
        {model.lastBuild === null ? (
          <span className="missing">{MISSING}</span>
        ) : (
          <Link to={journalPath(tenantId, { runId: model.lastBuild.runId })}>
            {model.lastBuild.runId}
          </Link>
        )}
      </td>
      <td className="datum num">
        {columns === null ? (
          <span className="missing">{MISSING}</span>
        ) : (
          formatCount(columns, locale)
        )}
      </td>
      <td>
        <StatusMark
          mark={contextMark(model.context.state)}
          label={contextStateLabel(t, model.context.state)}
        />
      </td>
      <td className="datum datum--quiet">{relativeTime(model.updatedAt, locale)}</td>
    </tr>
  );
}
