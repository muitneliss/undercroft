import { formatDateTime } from "@/lib/when.ts";
import { useWords } from "./hooks.ts";
import { QualitySummary } from "./ProfileEvidence.tsx";
import type { EngineeringProfile, ModelDetails } from "./profileSource.ts";
import type { ModelRecord } from "./types.ts";

export function ProfileOperations({
  model,
  detail,
}: {
  model: ModelRecord;
  detail: ModelDetails | null;
}): React.JSX.Element {
  const { t, locale } = useWords();
  const evidence = detail?.engineering;
  return (
    <div className="mw-stack">
      <p className="mw-lead">{t("modelsWorkspace.profileOperationsHint")}</p>
      {evidence !== undefined && (
        <small className="mw-caption">{t("modelsWorkspace.evidenceDemo")}</small>
      )}
      <div className="mw-metrics">
        <section className="mw-card mw-stack">
          <h3>{t("modelsWorkspace.status")}</h3>
          <strong data-failed={model.status === "failed"}>
            {t(`modelsWorkspace.${model.status}`)}
          </strong>
          <small>{formatDateTime(model.builtAt, locale)}</small>
          <p className="mw-caption">{t("modelsWorkspace.buildMeaning")}</p>
        </section>
        <section className="mw-card mw-stack">
          <h3>{t("modelsWorkspace.quality")}</h3>
          {evidence ? (
            <QualitySummary evidence={evidence} />
          ) : (
            <p>{t("modelsWorkspace.testUnknown")}</p>
          )}
          {evidence !== undefined && (
            <small>
              {t("modelsWorkspace.measuredAt", {
                time: formatDateTime(evidence.measuredAt, locale),
              })}
            </small>
          )}
        </section>
        <section className="mw-card mw-stack">
          <h3>{t("modelsWorkspace.freshness")}</h3>
          <strong>{t("modelsWorkspace.noMeasurement")}</strong>
          <p className="mw-caption">{t("modelsWorkspace.freshnessHint")}</p>
        </section>
      </div>
      {evidence !== undefined && (
        <>
          <Checks evidence={evidence} />
          <RunHistory evidence={evidence} />
        </>
      )}
      <details className="mw-card">
        <summary>{t("modelsWorkspace.moreTelemetry")}</summary>
        <p>{t("modelsWorkspace.telemetryHint")}</p>
      </details>
    </div>
  );
}

function Checks({ evidence }: { evidence: EngineeringProfile }): React.JSX.Element {
  const { t, locale } = useWords();
  return (
    <section className="mw-stack">
      <h3>{t("modelsWorkspace.tests")}</h3>
      <div className="mw-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("modelsWorkspace.testName")}</th>
              <th>{t("modelsWorkspace.testResult")}</th>
              <th>{t("modelsWorkspace.failingRows")}</th>
              <th>{t("modelsWorkspace.explanation")}</th>
            </tr>
          </thead>
          <tbody>
            {evidence.tests.map((test) => (
              <tr key={test.name}>
                <td>
                  <code>{test.name}</code>
                </td>
                <td>
                  <span className="mw-evidence-status" data-status={test.status}>
                    {t(`modelsWorkspace.${test.status}`)}
                  </span>
                </td>
                <td>{test.failures}</td>
                <td>{test.explanation[locale]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RunHistory({ evidence }: { evidence: EngineeringProfile }): React.JSX.Element {
  const { t, locale } = useWords();
  const longest = Math.max(...evidence.runs.map((run) => run.durationMs), 1);
  return (
    <section className="mw-stack">
      <h3>{t("modelsWorkspace.history")}</h3>
      <div className="mw-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("modelsWorkspace.runId")}</th>
              <th>{t("modelsWorkspace.runTime")}</th>
              <th>{t("modelsWorkspace.testResult")}</th>
              <th>{t("modelsWorkspace.duration")}</th>
              <th>{t("modelsWorkspace.runDetails")}</th>
            </tr>
          </thead>
          <tbody>
            {evidence.runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <code>{run.id}</code>
                </td>
                <td>{formatDateTime(run.at, locale)}</td>
                <td>
                  <span
                    className="mw-evidence-status"
                    data-status={run.status === "failed" ? "fail" : "pass"}
                  >
                    {t(`modelsWorkspace.${run.status}`)}
                  </span>
                </td>
                <td>
                  <meter
                    className="mw-duration"
                    aria-label={t("modelsWorkspace.duration")}
                    min={0}
                    max={longest}
                    value={run.durationMs}
                  />
                  {t("modelsWorkspace.milliseconds", { value: run.durationMs })}
                </td>
                <td>
                  <details>
                    <summary>{t("modelsWorkspace.runDetails")}</summary>
                    <p>{run.explanation[locale]}</p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
