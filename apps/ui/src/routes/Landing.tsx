/** The public title page; the sign-in and customer routes remain the working book. */
import { useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Colophon } from "@/components/Colophon.tsx";
import { LanguageSwitcher } from "@/components/LanguageSwitcher.tsx";
import { Mark } from "@/components/Mark.tsx";
import { usePageLamp } from "@/components/usePageLamp.ts";
import { useVaultFilm, type VaultRefs } from "@/components/useVaultFilm.ts";
import { STAGES, STEPS, type StepId } from "@/lib/vault/model.ts";
import type { VaultWords } from "@/lib/vault/runtime.ts";

import "@/styles/landing-agent.css";
import "@/styles/landing-workflow.css";
import "@/styles/landing-cover.css";
import "@/styles/landing-path.css";
import "@/styles/home.css";

const DOCUMENTATION = "https://github.com/muitneliss/undercroft#documentation";
const MCP_SETUP = "https://github.com/muitneliss/undercroft/blob/main/docs/runbook/mcp-setup.md";
const WORKFLOW_STEPS = [
  { title: "landing.workflowConnectTitle", body: "landing.workflowConnectBody" },
  { title: "landing.workflowAskTitle", body: "landing.workflowAskBody" },
  { title: "landing.workflowCheckTitle", body: "landing.workflowCheckBody" },
  { title: "landing.workflowDecideTitle", body: "landing.workflowDecideBody" },
] as const;
const STEP_WORDS = {
  invite: { title: "landing.stepInviteTitle", body: "landing.stepInviteBody" },
  connect: { title: "landing.stepConnectTitle", body: "landing.stepConnectBody" },
  choose: { title: "landing.stepChooseTitle", body: "landing.stepChooseBody" },
  run: { title: "landing.stepRunTitle", body: "landing.stepRunBody" },
  model: { title: "landing.stepModelTitle", body: "landing.stepModelBody" },
  ask: { title: "landing.stepAskTitle", body: "landing.stepAskBody" },
} as const satisfies Record<StepId, { title: string; body: string }>;

/**
 * The data's order of travel and the reader's, as two ordered lists: what a screen reader
 * gets, and what the vault behind them animates. The lists are the content; the film is the
 * picture of it and carries no word the lists do not.
 */
function DataPath({ refs }: { refs: VaultRefs }): React.JSX.Element {
  const { t } = useTranslation();
  const userPathId = useId();
  return (
    <section className="flow" aria-label={t("landing.pathLabel")}>
      <ol className="flow__stages" ref={refs.stages}>
        {STAGES.map((stage) => (
          <li key={stage} className="flow__stage">
            <h2>{t(`landing.${stage}Title`)}</h2>
            <p>{t(`landing.${stage}Body`)}</p>
          </li>
        ))}
      </ol>
      <div className="flow__band" ref={refs.band} aria-hidden="true" />
      <h2 id={userPathId} className="flow__path-title">
        {t("landing.userPathLabel")}
      </h2>
      <ol className="flow__steps" ref={refs.steps} aria-labelledby={userPathId}>
        {STEPS.map((step) => (
          <li key={step} className="flow__step">
            <strong>{t(STEP_WORDS[step].title)}</strong>
            <span>{t(STEP_WORDS[step].body)}</span>
          </li>
        ))}
      </ol>
      <div className="flow__foot">
        <p className="flow__note">{t("landing.principle")}</p>
      </div>
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
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const stagesRef = useRef<HTMLOListElement>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  const refs = useMemo<VaultRefs>(
    () => ({
      page: pageRef,
      canvas: canvasRef,
      band: bandRef,
      stages: stagesRef,
      steps: stepsRef,
    }),
    [],
  );
  const sourceNames = t("landing.sourcesBody");
  const refused = t("landing.vaultRefused");
  const echo = t("landing.vaultEcho");
  const words = useMemo<VaultWords>(
    () => ({ sourceNames: sourceNames.split("\n"), refused, echo }),
    [sourceNames, refused, echo],
  );
  useVaultFilm(refs, words);
  usePageLamp(pageRef);
  return (
    <div className="landing" ref={pageRef}>
      <div className="landing__vault" aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
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
      <main id={contentId}>
        <div className="landing__cover">
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
          <DataPath refs={refs} />
        </div>
        <div className="landing__sheet">
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
        </div>
      </main>
      <Colophon />
    </div>
  );
}
