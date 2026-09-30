/**
 * The Docker step: nothing is written until Docker answers `ready`.
 *
 * Each state `@undercroft/setup` can report gets its own next step, and a state the app cannot
 * fix -- a Linux user outside the `docker` group, a missing Compose plugin -- gets the fix in
 * words and a button to check again. Installing Docker is offered, never done unasked: it needs
 * an administrator and, on macOS and Windows, a licence a company may have to pay for, which is
 * said before the button.
 */

import type { DockerState } from "@undercroft/setup";
import { type ReactNode, useEffect } from "react";
import type { MessageKey } from "../../i18n/index.ts";
import { useCommands, useT, useWizard } from "../context.ts";
import { StepFrame, StepNav } from "../fields.tsx";
import type { DockerView } from "../wizard.ts";

function stateKey(state: DockerState | null): MessageKey {
  switch (state?.state) {
    case undefined:
      return "docker.checking";
    case "ready":
      return "docker.ready";
    case "missing":
      return "docker.missing";
    case "stopped":
      return "docker.stopped";
    case "no-permission":
      return "docker.noPermission";
    case "no-compose":
      return "docker.noCompose";
    default:
      return state satisfies never;
  }
}

function busyKey(busy: DockerView["busy"]): MessageKey | null {
  switch (busy) {
    case "checking":
      return "docker.checking";
    case "installing":
      return "docker.installing";
    case "starting":
      return "docker.starting";
    default:
      return null;
  }
}

/** What a person can do about a Docker that is not installed. */
function MissingHelp({ docker }: { readonly docker: DockerView }): ReactNode {
  const t = useT();
  const commands = useCommands();
  const { offer } = docker;
  if (offer === null) {
    return null;
  }
  return (
    <div className="stack">
      {offer.licence ? (
        <>
          <p className="note">{t("docker.licence")}</p>
          <button
            className="link"
            onClick={(): void => void commands.openLink("dockerLicence")}
            type="button"
          >
            {t("docker.licenceLink")}
          </button>
        </>
      ) : null}
      {docker.installFailed ? <p className="errata">{t("docker.installFailed")}</p> : null}
      {offer.runnable && offer.command !== null ? (
        <p className="note">{t("docker.command", { command: offer.command })}</p>
      ) : null}
      {!offer.runnable && offer.command !== null ? (
        <p className="note note--mono">{t("docker.runYourself", { command: offer.command })}</p>
      ) : null}
      <div className="row">
        {offer.runnable ? (
          <button
            className="button button--go"
            disabled={docker.busy !== null}
            onClick={(): void => void commands.installDocker()}
            type="button"
          >
            {t("docker.install")}
          </button>
        ) : null}
        <button
          className="button"
          onClick={(): void => void commands.openLink("dockerDownload")}
          type="button"
        >
          {t("docker.download")}
        </button>
      </div>
    </div>
  );
}

function RestartHelp({ docker }: { readonly docker: DockerView }): ReactNode {
  const t = useT();
  const commands = useCommands();
  return (
    <div className="stack">
      <p className="note">{t("docker.restartNeeded")}</p>
      {docker.restartFailed ? <p className="errata">{t("docker.restartFailed")}</p> : null}
      <div className="row">
        <button
          className="button button--go"
          onClick={(): void => void commands.restartForDocker()}
          type="button"
        >
          {t("docker.restart")}
        </button>
      </div>
    </div>
  );
}

export function DockerStep(): ReactNode {
  const t = useT();
  const commands = useCommands();
  const docker = useWizard((wizard) => wizard.docker);
  const unchecked = docker.state === null && docker.busy === null;

  useEffect(() => {
    if (unchecked) {
      void commands.checkDocker();
    }
  }, [unchecked, commands]);

  const busy = busyKey(docker.busy);
  const state = docker.state?.state;
  return (
    <StepFrame actions={<StepNav />} lead={t("docker.lead")} title={t("docker.title")}>
      <p aria-live="polite" className={state === "ready" ? "status status--ok" : "status"}>
        {busy === null
          ? t(stateKey(docker.state), {
              version: docker.state?.state === "ready" ? docker.state.composeVersion : "",
            })
          : t(busy)}
      </p>
      {busy === null && docker.restartNeeded ? <RestartHelp docker={docker} /> : null}
      {busy === null && !docker.restartNeeded && state === "missing" ? (
        <MissingHelp docker={docker} />
      ) : null}
      {busy === null && state === "stopped" && docker.offer?.canStart === true ? (
        <div className="row">
          <button
            className="button button--go"
            onClick={(): void => void commands.startDocker()}
            type="button"
          >
            {t("docker.start")}
          </button>
        </div>
      ) : null}
      {busy === null && state !== "ready" ? (
        <div className="row">
          <button
            className="button button--quiet"
            onClick={(): void => void commands.checkDocker()}
            type="button"
          >
            {t("docker.recheck")}
          </button>
        </div>
      ) : null}
    </StepFrame>
  );
}
