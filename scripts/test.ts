/**
 * The offline suite: `bun test --parallel` with the worker count bounded to half the cores this
 * process may use, at least one. `task ci:test` and `task ci:verify` reach it through the
 * `test` script; any argument is a `bun test` filter, as `task ci:test-one` passes one.
 *
 * Why bound it at all: Bun's default is one worker per core, and since PGlite 0.5 (#477) each
 * instance holds about 630 MB and boots about 1.5x slower. The real-server suites
 * (`apps/control-plane/src/handlers/exports.test.ts`, `trpcToken.test.ts`) boot a control plane
 * over PGlite in `beforeEach`, and with a worker per core those hooks crossed the 10 s timeout
 * whenever the machine was busy: two full gates failed with two or three such timeouts each,
 * while the same files passed alone in under two seconds. Measured on one tree, 18 cores and
 * 48 GB, load average 12-23: 18 workers took 91-94 s with 2-3 timeouts a run, 9 took 66.6 s
 * with none, 6 took 87.8 s with none. Fewer workers were faster as well as green, so the cause
 * is contention, not a hang.
 *
 * Why half the cores rather than a fixed number: a fixed 9 oversubscribes a 2-4 core CI runner
 * exactly as 18 did here. `availableParallelism()` counts the cores this process may run on, not
 * the machine's, so a container limited to two gets one worker.
 *
 * Why not raise the timeout instead: 10 s stays what it is for, a hang detector. A suite that
 * genuinely stops answering must still fail in seconds rather than wait out a larger margin.
 *
 * Why a script: `--parallel=<N>` takes a number and Bun has no expression, environment variable
 * or `bunfig.toml` key that computes one. `bunfig.toml`'s preload and ignores still apply, since
 * this runs `bun test` from the same directory with nothing else changed.
 */

import { availableParallelism } from "node:os";
import process from "node:process";

const workers = Math.max(1, Math.floor(availableParallelism() / 2));

// `process.execPath` is the Bun running this script, so the suite runs on the pinned version
// rather than whichever `bun` comes first on PATH.
const done = Bun.spawnSync(
  [
    process.execPath,
    "test",
    `--parallel=${String(workers)}`,
    "--timeout",
    "10000",
    ...process.argv.slice(2),
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);

// A run killed by a signal has no exit code; it failed, and must not read as a pass.
process.exit(done.exitCode ?? 1);
