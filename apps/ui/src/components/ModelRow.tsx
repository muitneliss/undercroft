/**
 * One model on the Models list: its name (and whether its draft is unsaved) with its author's
 * description under it, its last build's status and run, the columns that build made, what the
 * tests of the build serving its rows found (ADR 0129), what its saved SQL declares it reads,
 * and when it last changed. A value not known is MISSING, never a zero.
 *
 * A model nobody described shows nothing where the description would be: no badge, no
 * "missing" -- a flag on every model is the lesson of ADR 0112 (ADR 0137).
 *
 * What it reads is the model's own edges of the lineage, as plain names: a few, then how many
 * more, and a model whose upstream cannot all be read from its declarations says so beside
 * them, because a short or empty list there must not read as proof of no dependency (rule 2).
 * Names, not links: the row's one link is the model itself, and its editor lists them as doors.
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

/** How many of what a model reads its row names before it counts the rest. */
const NAMED_READS = 3;

/** One model on the list: its name, last build, run, columns, tests, reads, when it changed. */
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
        {model.description === null ? null : (
          <span className="datum datum--quiet model-row__description">{model.description}</span>
        )}
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
      <td className="datum">
        <DependsOnCell dependsOn={model.dependsOn} />
      </td>
      <td className="datum datum--quiet">{relativeTime(model.updatedAt, locale)}</td>
    </tr>
  );
}

/** What a model declares it reads, as its row says it; MISSING when the list did not say. */
function DependsOnCell({ dependsOn }: { dependsOn: ModelItem["dependsOn"] }): React.JSX.Element {
  const { t } = useTranslation();
  if (dependsOn === undefined) {
    return <span className="missing">{MISSING}</span>;
  }
  const { reads, undeclared } = dependsOn;
  const named = reads.slice(0, NAMED_READS).map((read) => read.name);
  const more = reads.length - named.length;
  return (
    <>
      {named.length > 0 ? <span>{named.join(", ")}</span> : null}
      {more > 0 ? (
        <span className="datum--quiet model-row__more">
          {t("models.dependsOnMore", { count: more })}
        </span>
      ) : null}
      {undeclared.length > 0 ? (
        <span className="label model-row__undeclared">{t("lineage.undeclared")}</span>
      ) : null}
      {reads.length === 0 && undeclared.length === 0 ? (
        <span className="datum--quiet">{t("lineage.readsNothing")}</span>
      ) : null}
    </>
  );
}
