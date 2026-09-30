/**
 * Run the visual tier (`apps/ui/src/**\/*.vrt.test.tsx`) inside the Playwright image, and bring
 * back only what a person needs to see. ADR 0099; `docs/runbook/visual-regression.md`.
 *
 * `task ci:visual` compares against the committed baselines and never writes one: a missing or
 * mismatched picture fails, and its capture and diff come back to `apps/ui/.vitest-attachments`,
 * which CI uploads. `task ci:visual-update` (`--update`) retakes the baselines and copies the
 * `__screenshots__` directories back into the checkout, for a person to review before committing.
 * Any other argument is a Vitest filter: `task ci:visual -- Tenants`.
 *
 * Why a container at all: a baseline is a picture of how THIS machine rasterises the page, and
 * macOS and Linux draw the same font differently. CI is Linux on amd64, so every run is -- the
 * platform is pinned even on an Apple-silicon Mac, where Docker emulates it, because Chromium's
 * arm64 and amd64 builds are not promised to paint the same pixels either.
 *
 * Why a COPY of the checkout inside it rather than the checkout itself: `node_modules` holds this
 * host's native binaries (esbuild, Rollup, Tailwind's oxide), one tree per workspace, and a Linux
 * install written over them would break the host's own `task ci:verify`. The copy gets its own
 * install from `bun.lock`, cached in a named volume so only the first run needs the network. The
 * checkout is written to in exactly the two places named above.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import ui from "../apps/ui/package.json" with { type: "json" };

const REPO = join(import.meta.dir, "..");
const PLATFORM = "linux/amd64";

/** The image is named by the pins it is built from, so a bumped pin is a new image. */
const { playwright } = ui.devDependencies;
const bun = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
const image = `undercroft-visual:${playwright}-bun${bun}`;

const update = process.argv.includes("--update");
const filters = process.argv.slice(2).filter((arg) => arg !== "--update");
/** The container runs as root; what it copies back is handed to whoever ran the task. */
const owner = `${String(process.getuid?.() ?? 0)}:${String(process.getgid?.() ?? 0)}`;

/**
 * The steps inside the container. Vitest's own exit status is the script's, and the copies back
 * still happen after a failure -- a failed run is exactly when the diffs are wanted.
 */
const inside = [
  "set -eu",
  "mkdir /work",
  "tar -C /src --exclude=node_modules --exclude=.git --exclude=.vitest-attachments -cf - . | tar -C /work -xf -",
  "cd /work && bun install --frozen-lockfile",
  `cd /work/apps/ui && status=0 && bun run visual ${update ? "--update" : ""} "$@" || status=$?`,
  "rm -rf /src/apps/ui/.vitest-attachments",
  "if [ -d .vitest-attachments ]; then cp -R .vitest-attachments /src/apps/ui/; fi",
  update
    ? "find src -type d -name __screenshots__ | tar -cf - -T - | tar -C /src/apps/ui -xf -"
    : "",
  `find /src/apps/ui/src /src/apps/ui/.vitest-attachments -name __screenshots__ -o -name .vitest-attachments 2>/dev/null | xargs -r chown -R ${owner}`,
  "exit $status",
].join("\n");

function run(command: string[], stdin?: Blob): void {
  const done = Bun.spawnSync(command, {
    cwd: REPO,
    stdin: stdin ?? "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (done.exitCode !== 0) {
    process.exit(done.exitCode ?? 1);
  }
}

// No build context: the Dockerfile copies nothing from the checkout, so it is read from stdin.
run(
  [
    "docker",
    "build",
    "--platform",
    PLATFORM,
    "--tag",
    image,
    "--build-arg",
    `PLAYWRIGHT_VERSION=${playwright}`,
    "--build-arg",
    `BUN_VERSION=${bun}`,
    "-",
  ],
  Bun.file(join(REPO, "apps/ui/visual.Dockerfile")),
);
run([
  "docker",
  "run",
  "--rm",
  "--init",
  "--ipc=host",
  "--platform",
  PLATFORM,
  "--volume",
  `${REPO}:/src`,
  "--volume",
  "undercroft-visual-bun-cache:/root/.bun/install/cache",
  // Vitest reads CI to decide whether a missing baseline may be written; a comparison run must not.
  ...(update ? [] : ["--env", "CI=true"]),
  image,
  "sh",
  "-c",
  inside,
  "sh",
  ...filters,
]);
