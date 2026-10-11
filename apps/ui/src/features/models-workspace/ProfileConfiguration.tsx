import { useWords } from "./hooks.ts";
import type { ModelDetails } from "./profileSource.ts";

export function ProfileConfiguration({ detail }: { detail: ModelDetails }): React.JSX.Element {
  const { t, locale } = useWords();
  const evidence = detail.engineering;
  return (
    <div className="mw-stack">
      <p className="mw-lead">{t("modelsWorkspace.profileSqlHint")}</p>
      <section className="mw-card mw-stack">
        <h3>{t("modelsWorkspace.config")}</h3>
        <dl className="mw-facts">
          <dt>{t("modelsWorkspace.materialization")}</dt>
          <dd>
            <code>{detail.materialization ?? t("modelsWorkspace.missing")}</code>
          </dd>
          <dt>{t("modelsWorkspace.relation")}</dt>
          <dd>
            <code>{evidence?.relation ?? t("modelsWorkspace.missing")}</code>
          </dd>
          <dt>{t("modelsWorkspace.environment")}</dt>
          <dd>{evidence?.environment ?? t("modelsWorkspace.missing")}</dd>
        </dl>
        {detail.materialization === "view" && (
          <p className="mw-caption">{t("modelsWorkspace.viewHint")}</p>
        )}
      </section>
      <p className="mw-note">{t("modelsWorkspace.sqlHint")}</p>
      <pre className="mw-sql">
        <code>{detail.sql ?? t("modelsWorkspace.missing")}</code>
      </pre>
      <p className="mw-caption">{t("modelsWorkspace.compiledUnknown")}</p>
      {evidence !== undefined && (
        <details className="mw-card">
          <summary>{t("modelsWorkspace.technicalIdentity")}</summary>
          <dl className="mw-facts">
            <dt>{t("modelsWorkspace.modelPath")}</dt>
            <dd>
              <code>{evidence.path}</code>
            </dd>
            <dt>{t("modelsWorkspace.uniqueId")}</dt>
            <dd>
              <code>{evidence.uniqueId}</code>
            </dd>
            <dt>{t("modelsWorkspace.tags")}</dt>
            <dd>{evidence.tags.join(", ")}</dd>
            <dt>{t("modelsWorkspace.contract")}</dt>
            <dd>{evidence.contract[locale]}</dd>
            <dt>{t("modelsWorkspace.access")}</dt>
            <dd>
              <code>{evidence.access}</code>
            </dd>
            <dt>{t("modelsWorkspace.sqlState")}</dt>
            <dd>{evidence.sqlComparison[locale]}</dd>
          </dl>
          <p className="mw-caption">{t("modelsWorkspace.accessHint")}</p>
        </details>
      )}
    </div>
  );
}
