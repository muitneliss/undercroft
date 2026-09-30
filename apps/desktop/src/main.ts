/**
 * The desktop app's composition root, and the only main-process module that touches Electrobun.
 *
 * It alone reads the environment and the platform, takes the global `fetch` and a real clock,
 * builds the one `Desktop` service, and binds it to the three things Electrobun gives the app:
 * the wizard's window (with its RPC, `rpc.ts`), the tray, and the updater (ADR 0098). Everything
 * below receives those as values (`layering.md`); `handlers/shell.ts` is the port they are
 * written against, implemented here.
 *
 * A first launch opens the wizard. A launch with an install goes straight to the tray, starts
 * the install at this app's release and opens it in the browser, already signed in on a desktop
 * install (ADR 0094). The tray's Settings reopens the wizard over the existing install.
 *
 * ## Closing and quitting
 *
 * - **Closing the wizard's window** leaves the app in the tray once there is an install, which
 *   the tray then operates. With nothing installed the tray has nothing to operate, so closing
 *   the window quits.
 * - **Quitting** -- Cmd+Q or the app menu's Quit, the tray's Quit, a system quit (AppleScript's
 *   `quit`, logging out, SIGTERM) -- takes Electrobun's one quit path, and `before-quit` below is
 *   this app's say in it: while a program the app started is running, the quit waits for
 *   `processes.stop` and then goes ahead, so no `docker compose` outlives the app. It never asks
 *   first: Electrobun does not say who is quitting, so a question meant for a person would stand
 *   in front of a logout too. What the quit stops is not lost (`services/processes.ts`).
 *   On macOS, Electrobun answers the system's quit request "cancelled" and then quits by itself,
 *   so AppleScript reports `User canceled (-128)` for a quit that happens.
 * - **Neither stops Undercroft.** The stack runs in Docker and keeps running; the tray's Stop
 *   is what stops it.
 *
 * On macOS the first launch of a downloaded app also shows a small "Undercroft Setup" window
 * saying the installation is complete. It is Electrobun's self-extractor, the process that
 * unpacked this app and opened it, and it waits for its Close button; Electrobun 2.0.2 has no
 * setting that closes it, and it is not this process's to close.
 *
 * `UNDERCROFT_DESKTOP_SMOKE=<file>` is the CI smoke check's switch (`scripts/check.ts`): the app
 * opens the wizard and walks it to the Docker step by itself (`handlers/smoke.ts`), writes what
 * that step's check found to the file, and quits.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { systemClock } from "@undercroft/core";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core/locale";
import { type Arch, defaultInstallDir, type Platform, processRunner } from "@undercroft/setup";
import Electrobun, {
  ApplicationMenu,
  BrowserView,
  BrowserWindow,
  type ElectrobunEvent,
  Tray,
  Updater,
  Utils,
} from "electrobun/main";
import pkg from "../package.json" with { type: "json" };
import { requestHandlers } from "./handlers/requests.ts";
import type { Shell, UpdateCheck, Updates } from "./handlers/shell.ts";
import { smokeWalk } from "./handlers/smoke.ts";
import {
  isTrayAction,
  onTrayAction,
  openInstalled,
  type TrayDeps,
  trayMenu,
} from "./handlers/tray.ts";
import { messages, type Translate } from "./i18n/index.ts";
import type { DesktopRpc, InstallEvent } from "./rpc.ts";
import { desktopService } from "./services/desktop.ts";
import { dockerSetup } from "./services/dockerSetup.ts";
import { filePrefs } from "./services/prefs.ts";
import { processGroup } from "./services/processes.ts";

const release = `v${pkg.version}`;
const platform: Platform =
  process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";
const arch: Arch = process.arch === "arm64" ? "arm64" : "x64";
const smokeFile = process.env.UNDERCROFT_DESKTOP_SMOKE;

/**
 * An app opened from the Finder or the Dock inherits launchd's PATH, `/usr/bin:/bin:/usr/sbin:
 * /sbin`, which holds neither Docker Desktop's `docker` nor Homebrew's `brew`. Without these the
 * runner would answer "not installed" for a Docker that is installed and running. A terminal's
 * PATH already has them, and appending changes nothing there.
 */
const MAC_PATHS = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/Applications/Docker.app/Contents/Resources/bin",
];
if (platform === "darwin") {
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  process.env.PATH = [...current, ...MAC_PATHS.filter((path) => !current.includes(path))].join(":");
}

const logsDir = Utils.paths.userLogs;
const logFile = join(logsDir, "install.log");
mkdirSync(logsDir, { recursive: true });

const prefs = filePrefs(join(Utils.paths.userData, "desktop.json"));
function log(line: string): void {
  appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
}
/** Every program the app runs, so a quit can stop them first (`before-quit` below). */
const processes = processGroup(processRunner);
const desktop = desktopService({
  run: processes.run,
  fetch: globalThis.fetch,
  clock: systemClock,
  platform,
  release,
  defaultDir: defaultInstallDir(platform, {
    home: homedir(),
    localAppData: process.env.LOCALAPPDATA,
  }),
  prefs,
  log,
});
const docker = dockerSetup({
  run: processes.run,
  clock: systemClock,
  platform,
  arch,
  prefs,
  log,
  // The launcher beside the runtime is what a person's shortcut opens.
  relaunchCommand: `"${join(dirname(process.execPath), "launcher.exe")}"`,
});

/** The reader's language, for the tray and its dialogs; the wizard tells us when it changes. */
let locale: Locale = (await prefs.read()).locale ?? DEFAULT_LOCALE;
function words(): Translate {
  return messages(locale);
}

// -- the wizard's window ------------------------------------------------------------------------

type WizardRpc = ReturnType<typeof BrowserView.defineRPC<DesktopRpc>>;
let wizard: { readonly window: BrowserWindow<WizardRpc>; readonly rpc: WizardRpc } | null = null;

function showWizard(): void {
  if (wizard !== null) {
    wizard.window.activate();
    return;
  }
  const handlers = requestHandlers({
    desktop,
    docker,
    shell,
    release,
    relabel: (chosen) => {
      locale = chosen;
      wizard?.window.setTitle(words()("app.windowTitle"));
      void refreshTray();
    },
    changed: () => void refreshTray(),
  });
  const walked =
    smokeFile === undefined
      ? handlers
      : smokeWalk(handlers, {
          script: (js) => wizard?.window.webview.executeJavascript(js),
          report: (line) => writeFileSync(smokeFile, `${line}\n`),
          quit: () => Utils.quit(),
        });
  const rpc = BrowserView.defineRPC<DesktopRpc>({
    // An install waits minutes on pulls and health; the view waits as long as it takes.
    maxRequestTime: Number.POSITIVE_INFINITY,
    handlers: { requests: walked, messages: {} },
  });
  const window = new BrowserWindow({
    title: words()("app.windowTitle"),
    url: "views://wizard/index.html",
    frame: { width: 820, height: 680 },
    rpc,
  });
  window.on("close", () => {
    wizard = null;
    // With nothing installed the tray has nothing to operate, so closing the wizard is leaving.
    void desktop.installed().then(({ answers }) => {
      if (answers === null && smokeFile === undefined) {
        Utils.quit();
      }
    });
  });
  wizard = { window, rpc };
}

// -- the port the handlers are written against --------------------------------------------------

const shell: Shell = {
  openUrl: (url) => {
    Utils.openExternal(url);
  },
  openFolder: (path) => {
    mkdirSync(path, { recursive: true });
    Utils.openPath(path);
  },
  chooseFolder: async (start) => {
    const chosen = await Utils.openFileDialog({
      startingFolder: start,
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    return chosen.find((path) => path !== "") ?? null;
  },
  ask: async (question) => {
    const { response } = await Utils.showMessageBox({
      type: question.kind,
      title: question.title,
      message: question.message,
      detail: question.detail ?? "",
      buttons: [...question.buttons],
      defaultId: 0,
      cancelId: question.cancel,
    });
    return response;
  },
  notify: (title, body) => Utils.showNotification({ title, body }),
  showWizard,
  closeWizard: () => wizard?.window.close(),
  progress: (event: InstallEvent) => wizard?.rpc.send.progress(event),
  quit: () => Utils.quit(),
};

const updates: Updates = {
  check: async (): Promise<UpdateCheck> => {
    if ((await Updater.localInfo.channel()) === "dev") {
      return { kind: "dev" };
    }
    const info = await Updater.checkForUpdate();
    if (info.error !== "") {
      return { kind: "failed", error: info.error };
    }
    return info.updateAvailable ? { kind: "available", version: info.version } : { kind: "none" };
  },
  apply: async () => {
    await Updater.downloadUpdate();
    const info = Updater.updateInfo();
    if (!info.updateReady) {
      return info.error === "" ? "download incomplete" : info.error;
    }
    // Restarting into the update is a quit, and `before-quit` would hold one back while a program
    // runs -- which cancels the restart rather than delaying it. So stop them first.
    await processes.stop();
    await Updater.applyUpdate();
    return null;
  },
};

// -- the tray -----------------------------------------------------------------------------------

// macOS draws a template image in the menu bar's own ink, light or dark; Windows and Linux have
// no such thing, and a black mark would vanish on a dark taskbar, so they show the app icon.
const tray = new Tray(
  platform === "darwin"
    ? { image: "views://assets/tray-Template.png", template: true, width: 18, height: 18 }
    : { image: "views://assets/tray.png", template: false, width: 32, height: 32 },
);

const trayDeps: TrayDeps = {
  desktop,
  shell,
  updates,
  t: words,
  logsDir,
  changed: () => void refreshTray(),
};

async function refreshTray(): Promise<void> {
  const { answers } = await desktop.installed();
  tray.setMenu(trayMenu(words(), answers !== null).map((item) => ({ ...item })));
}

tray.on("tray-clicked", (event) => {
  const data: unknown =
    typeof event === "object" && event !== null ? Reflect.get(event, "data") : null;
  const action: unknown =
    typeof data === "object" && data !== null ? Reflect.get(data, "action") : null;
  if (isTrayAction(action)) {
    void onTrayAction(action, trayDeps);
  }
});

// Cut, copy and paste reach a macOS webview only through the application menu's roles; without
// them a person could not paste an OAuth client secret into the wizard. Electrobun 2.0.2 gives the
// edit roles their shortcuts but not `quit`, so Cmd+Q is named here or it does nothing.
ApplicationMenu.setApplicationMenu([
  {
    submenu: [
      { role: "hide" },
      { role: "hideOthers" },
      { type: "divider" },
      { role: "quit", accelerator: "q" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "divider" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
]);

// -- quitting -----------------------------------------------------------------------------------

// Every quit reaches this, whoever asked (the module docstring). Electrobun does not await a
// handler, so a quit that must wait is refused now and asked for again once the programs have
// exited; the second request finds nothing running, unless something started meanwhile, which
// is then stopped the same way.
Electrobun.events.on("before-quit", (event: ElectrobunEvent<unknown, { allow: boolean }>) => {
  if (!processes.running()) {
    return;
  }
  event.response = { allow: false };
  void processes.stop().then(() => Utils.quit());
});

// -- launch -------------------------------------------------------------------------------------

await refreshTray();
const launched = await desktop.installed();
const resuming = (await prefs.read()).resume !== undefined;
if (smokeFile !== undefined || launched.answers === null || resuming) {
  showWizard();
} else {
  void openInstalled(trayDeps);
}
