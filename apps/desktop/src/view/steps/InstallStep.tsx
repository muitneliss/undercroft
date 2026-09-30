/**
 * What will happen, then it happening.
 *
 * Before anything is written, the install step says what it will do -- the mode, the folder, the
 * address, the release -- and whether the passwords and keys are made now or kept, which is the
 * one thing a re-configuration must never get wrong (`plan`). While it runs, each image Docker
 * pulls gets a row, so the minutes of a first pull read as progress rather than a hang.
 */

import type { ReactNode } from "react";
import { failureWords } from "../../i18n/failure.ts";
import { useCommands, useT, useWizard } from "../context.ts";
import { StepFrame } from "../fields.tsx";
import { plan } from "../rules.ts";

function Summary(): ReactNode {
  const t = useT();
  const wizard = useWizard((state) => state);
  const planned = plan(wizard);
  return (
    <ul className="summary">
      <li>
        {t("install.mode", {
          mode: planned.mode === "desktop" ? t("install.modeDesktop") : t("install.modeServer"),
        })}
      </li>
      <li className="mono">{t("install.dir", { dir: planned.dir })}</li>
      <li className="mono">{t("install.url", { url: planned.url })}</li>
      <li className="mono">{t("install.tag", { tag: planned.tag })}</li>
      <li>{planned.secrets === "keep" ? t("install.secretsKept") : t("install.secretsNew")}</li>
    </ul>
  );
}

function Progress(): ReactNode {
  const t = useT();
  const install = useWizard((wizard) => wizard.install);
  return (
    <div className="stack">
      <p aria-live="polite" className="status">
        {install.phase === null ? t("install.phase.writing") : t(`install.phase.${install.phase}`)}
      </p>
      {install.images.length === 0 ? null : (
        <ul className="images">
          {install.images.map((image) => (
            <li className={`image image--${image.state}`} key={image.image}>
              <span className="mono">{image.image}</span>
              <span className="image__state">{t(`install.image.${image.state}`)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mono line">{install.lastLine}</p>
    </div>
  );
}

function Failure(): ReactNode {
  const t = useT();
  const failure = useWizard((wizard) => wizard.install.failure);
  if (failure === null) {
    return null;
  }
  const words = failureWords(t, failure);
  return (
    <div className="stack" role="alert">
      <p className="errata">{words.message}</p>
      {words.detail === null ? null : <pre className="tail">{words.detail}</pre>}
    </div>
  );
}

export function InstallStep(): ReactNode {
  const t = useT();
  const commands = useCommands();
  const install = useWizard((wizard) => wizard.install);
  const back = useWizard((wizard) => wizard.back);
  const actions = install.running ? null : (
    <>
      <button className="button button--quiet" onClick={back} type="button">
        {t("nav.back")}
      </button>
      <button
        className="button button--go"
        onClick={(): void => void commands.install()}
        type="button"
      >
        {install.failure === null ? t("install.start") : t("install.retry")}
      </button>
    </>
  );
  return (
    <StepFrame actions={actions} lead={t("install.lead")} title={t("install.title")}>
      <Summary />
      {install.running ? <Progress /> : <Failure />}
    </StepFrame>
  );
}
