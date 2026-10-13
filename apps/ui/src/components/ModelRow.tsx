/**
 * One model on the Models list: its name (and whether its draft is unsaved), its last build's
 * status and run, the columns that build made, what the tests of the build serving its rows
 * found (ADR 0129), and when it last changed. A value not known is MISSING, never a zero.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { ModelItem } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { buildMark, buildMarkLabel } from "@/lib/modelBuild.ts";
import { formatCount, MISSING } from "@/lib/money.ts";
import { journalPath } from "@/lib/runs.ts";
import { testsLabel, testsMark } from "@/lib/testState.ts";
import { relativeTime } from "@/lib/when.ts";

/** One model on the list: its name, last build, run, columns, tests and when it changed. */
export function ModelRow({
  tenantId,
  model,
  base,
  unsaved,
  locale,
}: {
  tenantId: string;
  model: ModelItem;
  base: string;
  unsaved: boolean;
  locale: "vi" | "en";
}): React.JSX.Element {
  const { t } = useTranslation();
  const columns = model.lastBuild?.columnCount ?? null;
  return (
    <tr>
      <td>
        <Link className="journal__what" to={`${base}/${model.name}`}>
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
        {/* What the build serving its rows tested, beside a status that alone would
            read a build with failing tests as a success (ADR 0129). */}
        <StatusMark
          mark={testsMark(model.lastTests.state)}
          label={testsLabel(t, locale, model.lastTests)}
        />
      </td>
      <td className="datum datum--quiet">{relativeTime(model.updatedAt, locale)}</td>
    </tr>
  );
}
