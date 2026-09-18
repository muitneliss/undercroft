/**
 * Running the user's dbt project.
 *
 * dbt is a subprocess, not a library: we spawn the `dbt` binary that ships in the worker
 * image and stream its exit status back. We write no Python and import nothing from dbt --
 * it is a dependency we invoke, like `pg_dump`.
 *
 * Why in the worker image rather than a container the worker starts: starting a container
 * needs the Docker socket, and handing the socket to anything in this stack is the thing
 * the architecture refuses (it turns a compromise of that service into a host compromise).
 * A subprocess keeps Kestra and the worker socket-free. See ADR 0007.
 *
 * dbt runs as `undercroft_dbt`, whose privileges (no USAGE on `app`, create only in
 * `analytics`/`dq`) are what make it safe to run SQL a user wrote.
 */

// biome-ignore-all lint/correctness/noUndeclaredVariables: Globals the runtime supplies that Biome's resolver does not model -- Bun's own `Bun`, and DOM globals in .tsx files. tsc resolves all of them, and tsc is the check that binds here.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import { ConnectorError } from "@undercroft/core";

export interface TransformResult {
  readonly ok: boolean;
  readonly exitCode: number;
  /** Trimmed tail of dbt's output. Never the whole log: it can contain row values. */
  readonly output: string;
}

export interface TransformDeps {
  readonly projectDir: string;
  readonly profilesDir: string;
  /** Injected in tests; the process uses Bun.spawn against the real binary. */
  readonly spawn?: (
    cmd: readonly string[],
    cwd: string,
  ) => Promise<{ exitCode: number; output: string }>;
}

async function realSpawn(
  cmd: readonly string[],
  cwd: string,
): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, output: `${stdout}\n${stderr}` };
}

/**
 * Run `dbt build` over the project. A non-zero exit raises: a failed transform must not
 * report success, and the previous tables keep serving (stale, not wrong).
 */
export async function runTransform(
  deps: TransformDeps,
  opts: { select?: string } = {},
): Promise<TransformResult> {
  const spawn = deps.spawn ?? realSpawn;
  const cmd = [
    "dbt",
    "build",
    "--profiles-dir",
    deps.profilesDir,
    "--project-dir",
    deps.projectDir,
    ...(opts.select === undefined ? [] : ["--select", opts.select]),
  ];

  const { exitCode, output } = await spawn(cmd, deps.projectDir);
  // Only the tail, and only on failure paths does it reach a caller -- dbt's log can echo
  // row values from a failing test, and those belong in `dq`, not in an HTTP response.
  const tail = output.trim().split("\n").slice(-20).join("\n");

  if (exitCode !== 0) {
    throw new ConnectorError("dbt", "build", 0, `dbt build exited ${exitCode}`, {
      cause: new Error(tail),
    });
  }
  return { ok: true, exitCode, output: tail };
}
