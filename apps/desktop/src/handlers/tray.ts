/**
 * The tray: what its menu offers, and what each item does.
 *
 * The tray is how an installed Undercroft is operated day to day -- open it, start and stop it,
 * see its services, find its log, update the app, uninstall -- so after the first install the
 * wizard's window is only for Settings. The menu is data (`trayMenu`), bound to a native tray in
 * `main.ts`; each action calls the service and words its answer in a dialog or a notification.
 *
 * Opening Undercroft always goes to exactly the install's public URL, never `127.0.0.1`: the
 * local owner's sign-in is refused on any other host name (ADR 0094).
 */

import { installUrl } from "@undercroft/setup/answers";
import type { Translate } from "../i18n/index.ts";
import { failureWords } from "../i18n/failure.ts";
import type { Desktop } from "../services/desktop.ts";
import type { Shell, Updates } from "./shell.ts";

export const TRAY_ACTIONS = [
  "open",
  "start",
  "stop",
  "status",
  "settings",
  "logs",
  "updates",
  "uninstall",
  "quit",
] as const;

export type TrayAction = (typeof TRAY_ACTIONS)[number];

export type TrayItem =
  | {
      readonly type: "normal";
      readonly label: string;
      readonly action: TrayAction;
      readonly enabled: boolean;
    }
  | { readonly type: "divider" };

/** The menu, worded. Items that act on an install are off until there is one. */
export function trayMenu(t: Translate, installed: boolean): TrayItem[] {
  function item(action: TrayAction, enabled = true): TrayItem {
    return { type: "normal", label: t(`tray.${action}`), action, enabled };
  }
  return [
    item("open"),
    { type: "divider" },
    item("start", installed),
    item("stop", installed),
    item("status", installed),
    { type: "divider" },
    item("settings"),
    item("logs"),
    item("updates"),
    item("uninstall", installed),
    { type: "divider" },
    item("quit"),
  ];
}

const ACTIONS: ReadonlySet<unknown> = new Set(TRAY_ACTIONS);

/** Whether a tray click's payload names one of the menu's actions. */
export function isTrayAction(value: unknown): value is TrayAction {
  return ACTIONS.has(value);
}

export interface TrayDeps {
  readonly desktop: Desktop;
  readonly shell: Shell;
  readonly updates: Updates;
  /** The words in the reader's current language. */
  readonly t: () => Translate;
  /** Where the install log is written. */
  readonly logsDir: string;
  /** The install changed: rebuild the menu. */
  readonly changed: () => void;
}

async function tell(deps: TrayDeps, message: string, detail?: string): Promise<void> {
  const t = deps.t();
  await deps.shell.ask({
    kind: "info",
    title: t("app.name"),
    message,
    ...(detail === undefined ? {} : { detail }),
    buttons: [t("dialog.ok")],
    cancel: 0,
  });
}

/**
 * Start what is installed and open it -- the second launch, and the tray's Start. With nothing
 * installed, or a Docker that is not running, it opens the wizard, which is where both are dealt
 * with.
 */
export async function openInstalled(deps: TrayDeps): Promise<void> {
  const t = deps.t();
  const { answers } = await deps.desktop.installed();
  if (answers === null) {
    deps.shell.showWizard();
    return;
  }
  deps.shell.notify(t("app.name"), t("dialog.starting"));
  const outcome = await deps.desktop.start(deps.shell.progress);
  deps.changed();
  if (outcome.ok) {
    deps.shell.notify(t("app.name"), t("dialog.started", { url: outcome.url }));
    deps.shell.openUrl(outcome.url);
    return;
  }
  if (outcome.reason === "docker" || outcome.reason === "no-install") {
    deps.shell.showWizard();
    return;
  }
  // Two sentences, each whole, one below the other: the words of a failure are never spliced
  // into the sentence that introduces them (`.claude/rules/i18n.md`).
  const words = failureWords(t, outcome);
  const detail = words.detail === null ? words.message : `${words.message}\n\n${words.detail}`;
  await tell(deps, t("dialog.startFailed"), detail);
}

async function open(deps: TrayDeps): Promise<void> {
  const { answers } = await deps.desktop.installed();
  if (answers === null) {
    deps.shell.showWizard();
    return;
  }
  deps.shell.openUrl(installUrl(answers));
}

async function stop(deps: TrayDeps): Promise<void> {
  const t = deps.t();
  const result = await deps.desktop.stop();
  deps.changed();
  if (result === null) {
    await tell(deps, t("dialog.noInstall"));
  } else if (result.ok) {
    deps.shell.notify(t("app.name"), t("dialog.stopped"));
  } else {
    await tell(deps, t("dialog.stopFailed"), result.tail);
  }
}

async function status(deps: TrayDeps): Promise<void> {
  const t = deps.t();
  const services = await deps.desktop.status();
  if (services === null) {
    await tell(deps, t("dialog.statusUnknown"));
    return;
  }
  const rows = services.map((service) =>
    t("dialog.statusRow", {
      service: service.service,
      state: service.health === "" ? service.state : `${service.state} (${service.health})`,
    }),
  );
  await tell(
    deps,
    t("dialog.statusTitle"),
    rows.length === 0 ? t("dialog.statusNone") : rows.join("\n"),
  );
}

async function updates(deps: TrayDeps): Promise<void> {
  const t = deps.t();
  const check = await deps.updates.check();
  switch (check.kind) {
    case "none":
      await tell(deps, t("dialog.updatesNone"));
      return;
    case "dev":
      await tell(deps, t("dialog.updatesDev"));
      return;
    case "failed":
      await tell(deps, t("dialog.updatesFailed", { error: check.error }));
      return;
    case "available":
      break;
    default:
      return check satisfies never;
  }
  const chosen = await deps.shell.ask({
    kind: "question",
    title: t("app.name"),
    message: t("dialog.updatesAvailable", { version: check.version }),
    detail: t("dialog.updatesStack"),
    buttons: [t("dialog.updatesInstall"), t("dialog.updatesLater")],
    cancel: 1,
  });
  if (chosen !== 0) {
    return;
  }
  const error = await deps.updates.apply();
  if (error !== null) {
    await tell(deps, t("dialog.updatesFailed", { error }));
  }
}

async function uninstall(deps: TrayDeps): Promise<void> {
  const t = deps.t();
  const KEEP = 0;
  const ALL = 1;
  const chosen = await deps.shell.ask({
    kind: "warning",
    title: t("dialog.uninstallTitle"),
    message: t("dialog.uninstallQuestion"),
    detail: t("dialog.uninstallDetail"),
    buttons: [t("dialog.uninstallKeep"), t("dialog.uninstallAll"), t("dialog.cancel")],
    cancel: 2,
  });
  if (chosen !== KEEP && chosen !== ALL) {
    return;
  }
  const keepData = chosen === KEEP;
  // Deleting data is asked twice, and the second question defaults to not doing it.
  if (!keepData) {
    const sure = await deps.shell.ask({
      kind: "warning",
      title: t("dialog.uninstallTitle"),
      message: t("dialog.uninstallConfirm"),
      buttons: [t("dialog.cancel"), t("dialog.uninstallAll")],
      cancel: 0,
    });
    if (sure !== 1) {
      return;
    }
  }
  const { dir } = await deps.desktop.installed();
  const result = await deps.desktop.uninstall(keepData);
  deps.changed();
  if (result === null) {
    await tell(deps, t("dialog.noInstall"));
  } else if (result.ok) {
    await tell(
      deps,
      keepData ? t("dialog.uninstallDoneKeep", { dir }) : t("dialog.uninstallDoneAll"),
    );
  } else {
    await tell(deps, t("dialog.uninstallFailed"), result.tail);
  }
}

export async function onTrayAction(action: TrayAction, deps: TrayDeps): Promise<void> {
  switch (action) {
    case "open":
      return await open(deps);
    case "start":
      return await openInstalled(deps);
    case "stop":
      return await stop(deps);
    case "status":
      return await status(deps);
    case "settings":
      deps.shell.showWizard();
      return;
    case "logs":
      deps.shell.openFolder(deps.logsDir);
      return;
    case "updates":
      return await updates(deps);
    case "uninstall":
      return await uninstall(deps);
    case "quit":
      deps.shell.quit();
      return;
    default:
      return action satisfies never;
  }
}
