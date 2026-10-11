import { formatDateTime } from "@/lib/when.ts";
import { useNavigation, useWords } from "./hooks.ts";
import type { EngineeringProfile, ModelDetails } from "./profileSource.ts";

export function MissingProfile(): React.JSX.Element {
  const { t } = useWords();
  const go = useNavigation();
  return (
    <section className="mw-note mw-stack">
      <p>{t("modelsWorkspace.missingDetailHint")}</p>
      <button
        className="mw-link"
        type="button"
        onClick={(): void =>
          go({ view: "detail", model: "int_invoice_balance", profile: null, from: null })
        }
      >
        {t("modelsWorkspace.engineeringExample")}
      </button>
    </section>
  );
}

export function QualitySummary({ evidence }: { evidence: EngineeringProfile }): React.JSX.Element {
  const { t } = useWords();
  return (
    <span>
      {t("modelsWorkspace.qualitySummary", {
        passed: evidence.tests.filter((test) => test.status === "pass").length,
        warned: evidence.tests.filter((test) => test.status === "warn").length,
        failed: evidence.tests.filter((test) => test.status === "fail").length,
      })}
    </span>
  );
}

export function ProfileEvidence({ evidence }: { evidence: EngineeringProfile }): React.JSX.Element {
  const { t, locale } = useWords();
  const go = useNavigation();
  return (
    <section className="mw-note mw-stack">
      <small className="mw-caption">{t("modelsWorkspace.evidenceDemo")}</small>
      <h3>{t("modelsWorkspace.trust")}</h3>
      <p>{evidence.caveat[locale]}</p>
      <dl className="mw-facts">
        <dt>{t("modelsWorkspace.owner")}</dt>
        <dd>{evidence.owner}</dd>
        <dt>{t("modelsWorkspace.quality")}</dt>
        <dd>
          <QualitySummary evidence={evidence} />
        </dd>
        <dt>{t("modelsWorkspace.freshness")}</dt>
        <dd>{t("modelsWorkspace.noFreshness")}</dd>
      </dl>
      <button type="button" className="mw-link" onClick={(): void => go({ tab: "operations" })}>
        {t("modelsWorkspace.operations")}
      </button>
    </section>
  );
}

export function DataEvidence({ detail }: { detail: ModelDetails }): React.JSX.Element {
  const { t, locale } = useWords();
  return (
    <div className="mw-evidence-grid">
      <section className="mw-card mw-stack">
        <h3>{t("modelsWorkspace.declaredKey")}</h3>
        <code>{detail.engineering?.key.join(" + ") ?? t("modelsWorkspace.missing")}</code>
        <p className="mw-caption">{t("modelsWorkspace.keyHint")}</p>
      </section>
      <section className="mw-card mw-stack">
        <h3>{t("modelsWorkspace.rowCount")}</h3>
        <strong className="mw-metric-value">
          {detail.rowCount ?? t("modelsWorkspace.noMeasurement")}
        </strong>
        {detail.engineering !== undefined && (
          <small>
            {t("modelsWorkspace.measuredAt", {
              time: formatDateTime(detail.engineering.measuredAt, locale),
            })}
          </small>
        )}
        <p className="mw-caption">{t("modelsWorkspace.rowCountHint")}</p>
      </section>
    </div>
  );
}
