/**
 * The desktop app's check: what the offline gate cannot see, on the machine it runs on.
 *
 * 1. **The SDK's types.** `electrobun prepare` projects Electrobun's SDK into `.hutch/devkit`,
 *    and `tsconfig.electrobun.json` typechecks the three modules the gate leaves out -- the
 *    composition root, the view's bridge and its entry -- against it. Only diagnostics in this
 *    app's own files fail the check: the SDK ships as TypeScript source, and some of it does not
 *    pass this repository's stricter compiler flags, which is not this app's to fix.
 * 2. **The build.** A development build of the app for this platform.
 * 3. **The bundle.** The wizard's page, script, sheet, fonts and tray images are where the main
 *    process will look for them.
 * 4. **The app.** The built app is launched with `UNDERCROFT_DESKTOP_SMOKE`, walks itself to the
 *    Docker step (`src/handlers/smoke.ts`) and reports what that step's check found. On Linux
 *    with no display it runs under `xvfb-run`. `--no-launch` skips this step, and says so,
 *    for a machine that cannot open a window at all.
 *
 * It needs the network the first time (the toolchain and the runtime are downloaded), and
 * nothing else: no Docker, no credentials. Docker's state is reported, not required.
 *
 * Runnable as `task ci:desktop-check`.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { APP, electrobun } from "./build.ts";

const TSC = join(APP, "..", "..", "node_modules", "typescript", "bin", "tsc");
/** The launcher Electrobun puts in every build: `launcher` on macOS and Linux, `.exe` on Windows. */
const LAUNCHER = /(?:^|\/)launcher(?:\.exe)?$/u;
const SMOKE_TIMEOUT_MS = 120_000;
const POLL_MS = 500;

function fail(what: string, detail = ""): never {
  throw new Error(`desktop check failed: ${what}${detail === "" ? "" : `\n${detail}`}`);
}

function typecheck(): void {
  const done = Bun.spawnSync(
    [process.execPath, TSC, "-p", "tsconfig.electrobun.json", "--pretty", "false"],
    { cwd: APP, stdout: "pipe", stderr: "pipe" },
  );
  const lines = `${done.stdout.toString()}${done.stderr.toString()}`.split("\n");
  // A diagnostic starts at column 0 with its file; its continuation lines are indented.
  const ours = lines.filter(
    (line) =>
      line.startsWith("src/") || line.startsWith("scripts/") || line.startsWith("electrobun"),
  );
  if (ours.length > 0) {
    fail("the app does not typecheck against the Electrobun SDK", ours.join("\n"));
  }
  process.stdout.write("typecheck against the SDK: clean\n");
}

/** Every file under `dir`, as paths relative to it with `/` separators. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path).map((inner) => `${name}/${inner}`) : [name];
  });
}

/** The development build this machine produced: `build/dev-<os>-<arch>`. */
function builtDir(): string {
  const build = join(APP, "build");
  const found = readdirSync(build).find((name) => name.startsWith("dev-"));
  if (found === undefined) {
    fail(`no development build under ${build}`);
  }
  return join(build, found);
}

const EXPECTED = [
  "views/wizard/index.html",
  "views/wizard/index.js",
  "views/wizard/index.css",
  "views/wizard/fonts/archivo-latin.woff2",
  "views/wizard/fonts/mono-latin.woff2",
  "views/assets/tray-Template.png",
  "views/assets/tray.png",
];

function checkBundle(dir: string): string {
  const files = walk(dir);
  const missing = EXPECTED.filter((path) => !files.some((file) => file.endsWith(path)));
  if (missing.length > 0) {
    fail("the bundle is missing files the app loads", missing.join("\n"));
  }
  const found = files.find((file) => LAUNCHER.test(file));
  if (found === undefined) {
    fail(`no launcher in ${dir}`);
  }
  process.stdout.write(`bundle: ${EXPECTED.length} expected files present\n`);
  return join(dir, ...found.split("/"));
}

async function launch(program: string): Promise<void> {
  const staging = mkdtempSync(join(tmpdir(), "undercroft-desktop-check-"));
  const report = join(staging, "smoke.txt");
  const headless =
    process.platform === "linux" && (process.env.DISPLAY ?? "") === "" && Bun.which("xvfb-run");
  const command = headless ? ["xvfb-run", "-a", program] : [program];
  const app = Bun.spawn(command, {
    env: { ...process.env, UNDERCROFT_DESKTOP_SMOKE: report },
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  try {
    while (!existsSync(report) && Date.now() < deadline && app.exitCode === null) {
      await Bun.sleep(POLL_MS);
    }
    if (!existsSync(report)) {
      app.kill();
      const output = `${await new Response(app.stdout).text()}${await new Response(app.stderr).text()}`;
      fail(`the app did not reach the Docker step within ${SMOKE_TIMEOUT_MS / 1000}s`, output);
    }
    const said = readFileSync(report, "utf8").trim();
    if (!said.startsWith("ok docker=")) {
      fail("the smoke walk reported something unexpected", said);
    }
    process.stdout.write(`app: walked to the Docker step (${said})\n`);
  } finally {
    app.kill();
    rmSync(staging, { recursive: true, force: true });
  }
}

electrobun(["prepare"]);
typecheck();
electrobun(["build", "--env=dev"]);
const launcher = checkBundle(builtDir());
if (process.argv.includes("--no-launch")) {
  process.stdout.write(
    `app: NOT launched (--no-launch): ${relative(APP, launcher).split(sep).join("/")}\n`,
  );
} else {
  await launch(launcher);
}
process.stdout.write("desktop check passed\n");
