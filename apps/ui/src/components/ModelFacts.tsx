/**
 * What a reader asks of one model before reading its SQL, as a row of facts under its name:
 * how its last build went, whether what is on screen is what the server holds, which run built
 * it, and how many columns that made. The `RunDetail` fact row's pattern -- one label over one
 * value -- with values that are marks and links rather than only text.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { ModelDetail } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { buildMark, buildMarkLabel, builtColumnCount } from "@/lib/modelBuild.ts";
import { formatCount, MISSING } from "@/lib/money.ts";
import { journalPath } from "@/lib/runs.ts";

/** One label over one value, the pair the model's fact row is made of (as `RunDetail`'s). */
function Fact({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <span className="stack stack--tight">
      <span className="label">{label}</span>
      <span className="datum">{children}</span>
    </span>
  );
}

/**
 * A model never built says so as a state, and has no run and no known columns: those two are
 * MISSING, never a zero or an empty cell (`builtColumnCount` says why an empty list of columns
 * is not "none").
 */
export function ModelFacts({
  tenantId,
  stored,
  dirty,
  locale,
}: {
  tenantId: string;
  stored: ModelDetail;
  dirty: boolean;
  locale: "vi" | "en";
}): React.JSX.Element {
  const { t } = useTranslation();
  const built = stored.lastBuild;
  const columns = builtColumnCount(built);
  return (
    <div className="row">
      <Fact label={t("models.colBuild")}>
        <StatusMark
          mark={buildMark(built?.status ?? null)}
          label={buildMarkLabel(t, built?.status ?? null)}
        />
      </Fact>
      <Fact label={t("models.factSql")}>{dirty ? t("models.unsaved") : t("models.saved")}</Fact>
      <Fact label={t("models.colRun")}>
        {built === null ? (
          <span className="missing">{MISSING}</span>
        ) : (
          <Link to={journalPath(tenantId, { runId: built.runId })}>{built.runId}</Link>
        )}
      </Fact>
      <Fact label={t("models.factColumns")}>
        {columns === null ? (
          <span className="missing">{MISSING}</span>
        ) : (
          formatCount(columns, locale)
        )}
      </Fact>
    </div>
  );
}
