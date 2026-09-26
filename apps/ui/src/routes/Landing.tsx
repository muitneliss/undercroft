/** The public title page; the sign-in and customer routes remain the working book. */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Colophon } from "@/components/Colophon.tsx";
import { ArrowRight } from "@/components/Icon.tsx";
import { LanguageSwitcher } from "@/components/LanguageSwitcher.tsx";
import { Mark } from "@/components/Mark.tsx";

import "@/styles/landing-agent.css";
import "@/styles/landing-workflow.css";
import "@/styles/home.css";

const DOCUMENTATION = "https://github.com/muitneliss/undercroft#documentation";
const MCP_SETUP = "https://github.com/muitneliss/undercroft/blob/main/docs/runbook/mcp-setup.md";
const STAGES = ["sources", "raw", "models", "reports"] as const;
const WORKFLOW_STEPS = [
  { title: "landing.workflowConnectTitle", body: "landing.workflowConnectBody" },
  { title: "landing.workflowAskTitle", body: "landing.workflowAskBody" },
  { title: "landing.workflowCheckTitle", body: "landing.workflowCheckBody" },
  { title: "landing.workflowDecideTitle", body: "landing.workflowDecideBody" },
] as const;

/** The data's order of travel, expressed as an ordered list rather than a picture. */
function DataPath(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section aria-label={t("landing.pathLabel")}>
      <ol className="landing-flow">
        {STAGES.map((stage) => (
          <li key={stage}>
            <h2>
              {t(`landing.${stage}Title`)}
              {stage === "reports" ? null : <ArrowRight size={18} />}
            </h2>
            <p>{t(`landing.${stage}Body`)}</p>
          </li>
        ))}
      </ol>
      <p className="landing__principle">{t("landing.principle")}</p>
    </section>
  );
}

/** A read-only customer-call example shows how MCP uses the existing product surface. */
function McpWorkflow(): React.JSX.Element {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section className="landing__workflow" aria-labelledby={titleId}>
      <div className="landing__workflow-heading">
        <h2 id={titleId}>{t("landing.workflowTitle")}</h2>
        <p>{t("landing.workflowLead")}</p>
      </div>
      <ol className="landing__workflow-steps">
        {WORKFLOW_STEPS.map((step) => (
          <li key={step.title}>
            <h3>{t(step.title)}</h3>
            <p>{t(step.body)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Landing(): React.JSX.Element {
  const { t } = useTranslation();
  const contentId = useId();
  const titleId = useId();
  const agentId = useId();
  const startId = useId();
  return (
    <div className="landing">
      <a className="landing__skip" href={`#${contentId}`}>
        {t("landing.skip")}
      </a>
      <header className="landing__header">
        <Link className="landing__brand" to="/" aria-label={t("app.name")}>
          <Mark size={36} />
          {t("app.name")}
        </Link>
        <nav className="landing__nav" aria-label={t("nav.sections")}>
          <a href={DOCUMENTATION}>{t("landing.docs")}</a>
          <Link to="/sign-in">{t("signIn.signIn")}</Link>
          <LanguageSwitcher />
        </nav>
      </header>
      <main id={contentId} className="landing__main">
        <section className="landing__hero" aria-labelledby={titleId}>
          <h1 id={titleId}>
            <span>{t("landing.title")}</span>
            <span>{t("landing.titleEnd")}</span>
          </h1>
          <p className="landing__lead">{t("landing.lead")}</p>
          <div className="landing__actions">
            <Link className="plate plate--primary" to="/sign-in">
              {t("signIn.signIn")}
            </Link>
            <a className="landing__docs" href={DOCUMENTATION}>
              {t("landing.readDocs")}
            </a>
          </div>
          <p className="landing__invitation">{t("landing.invitation")}</p>
        </section>
        <DataPath />
        <section className="landing__agent" aria-labelledby={agentId}>
          <h2 id={agentId}>{t("landing.agentTitle")}</h2>
          <div>
            <p>{t("landing.agentBody")}</p>
            <p>{t("landing.agentDetail")}</p>
            <a href={MCP_SETUP}>{t("landing.agentDocs")}</a>
          </div>
        </section>
        <McpWorkflow />
        <section className="landing__start" aria-labelledby={startId}>
          <h2 id={startId}>{t("landing.startTitle")}</h2>
          <p>{t("landing.startBody")}</p>
          <Link to="/sign-in">{t("landing.openWorkspace")}</Link>
        </section>
      </main>
      <Colophon />
    </div>
  );
}
