/**
 * The wizard's requests, answered: the transport between the webview and the service.
 *
 * Each handler takes what the view sent, calls the service or the shell once, and returns the
 * value. None decides anything about an install -- that is `services/desktop.ts`, which the tray
 * reaches too -- and none words anything, because the view words every answer itself.
 *
 * The one thing only this layer knows is where a link goes. The guides are this release's own
 * runbooks, so a person registering a Xero app reads the steps that match the app they run; the
 * view names a link and never holds a URL it could be made to open.
 */

import type { Locale } from "@undercroft/core/locale";
import { installUrl } from "@undercroft/setup/answers";
import type { BunApi, BunRequests, Link } from "../rpc.ts";
import type { Desktop } from "../services/desktop.ts";
import type { DockerSetup } from "../services/dockerSetup.ts";
import type { Shell } from "./shell.ts";

export interface RequestDeps {
  readonly desktop: Desktop;
  readonly docker: DockerSetup;
  readonly shell: Shell;
  /** This app's release, which the guides it links to are read at. */
  readonly release: string;
  /** The reader chose a language: reword what the main process shows, the tray. */
  readonly relabel: (locale: Locale) => void;
  /** Something was installed or changed: the tray's menu may need to say so. */
  readonly changed: () => void;
}

const REPOSITORY = "https://github.com/muitneliss/undercroft";

async function linkTo(link: Link, deps: RequestDeps): Promise<string> {
  switch (link) {
    case "googleIngestGuide":
      return `${REPOSITORY}/blob/${deps.release}/docs/runbook/google-ingestion-setup.md`;
    case "xeroGuide":
      return `${REPOSITORY}/blob/${deps.release}/docs/runbook/xero-setup.md`;
    case "dockerLicence":
      return "https://docs.docker.com/subscription/desktop-license/";
    // The setup package's plan knows the download for this platform and CPU.
    case "dockerDownload":
      return (await deps.docker.offer()).manualUrl;
    default:
      return link satisfies never;
  }
}

type Answer<K extends keyof BunRequests> = Promise<BunRequests[K]["response"]>;

export function requestHandlers(deps: RequestDeps): BunApi {
  const { desktop, docker, shell } = deps;
  return {
    boot: (): Answer<"boot"> => desktop.boot(),
    detectDocker: (): Answer<"detectDocker"> => docker.detect(),
    dockerOffer: (): Answer<"dockerOffer"> => docker.offer(),
    installDocker: (): Answer<"installDocker"> => docker.install(),
    startDocker: (): Answer<"startDocker"> => docker.start(),
    restartForDocker: async ({ mode }): Answer<"restartForDocker"> => ({
      ok: await docker.restartForDocker(mode),
    }),
    chooseFolder: ({ current }): Answer<"chooseFolder"> => shell.chooseFolder(current),
    install: async ({ answers, dir }): Answer<"install"> => {
      const outcome = await desktop.install(answers, dir, shell.progress);
      deps.changed();
      return outcome;
    },
    openInstall: async (): Answer<"openInstall"> => {
      const { answers } = await desktop.installed();
      if (answers === null) {
        return false;
      }
      shell.openUrl(installUrl(answers));
      return true;
    },
    openLink: async ({ link }): Answer<"openLink"> => {
      shell.openUrl(await linkTo(link, deps));
      return true;
    },
    setLocale: async ({ locale }): Answer<"setLocale"> => {
      await desktop.setLocale(locale);
      deps.relabel(locale);
      return true;
    },
    close: (): Answer<"close"> => {
      shell.closeWizard();
      return Promise.resolve(true);
    },
  };
}
