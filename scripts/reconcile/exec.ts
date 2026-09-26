/**
 * The command seam: how the suite reads OSTWIN (`python3 scripts/ask.py`) and Undercroft (the
 * `undercroft` CLI) without touching either system's database.
 *
 * Narrow on purpose, like the HTTP seam in `packages/connector-runtime`: the real runner
 * spawns a process, the in-memory one replays recorded output, and every adapter above this
 * line runs offline against the second. An unmodelled command is an error, never an empty
 * success -- an adapter that calls something nobody recorded must fail the test, not read
 * "no rows" and report a clean reconciliation over nothing.
 */

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly cwd?: string;
}

export interface CommandRunner {
  run: (argv: readonly string[], options?: CommandOptions) => Promise<CommandResult>;
}

/** A runner over real processes. `PATH` is inherited, so the CLI must be installed there. */
export function spawnRunner(): CommandRunner {
  return {
    async run(argv, options = {}): Promise<CommandResult> {
      const child = Bun.spawn([...argv], {
        stdout: "pipe",
        stderr: "pipe",
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, stdout, stderr };
    },
  };
}

/** Replays recorded output for an exact argv; refuses anything it was not told about. */
export class InMemoryRunner implements CommandRunner {
  readonly #routes = new Map<string, CommandResult[]>();
  readonly #calls: string[][] = [];

  on(argv: readonly string[], result: Partial<CommandResult> & { stdout: string }): this {
    const key = JSON.stringify(argv);
    const queue = this.#routes.get(key) ?? [];
    queue.push({ code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr ?? "" });
    this.#routes.set(key, queue);
    return this;
  }

  get calls(): readonly (readonly string[])[] {
    return this.#calls;
  }

  run(argv: readonly string[]): Promise<CommandResult> {
    this.#calls.push([...argv]);
    const key = JSON.stringify(argv);
    const queue = this.#routes.get(key);
    const [head, ...rest] = queue ?? [];
    if (head === undefined) {
      const known = [...this.#routes.keys()].join("\n  ") || "(nothing recorded)";
      return Promise.reject(new Error(`no recorded output for ${key}\nrecorded:\n  ${known}`));
    }
    // The last recorded result keeps answering repeated identical commands.
    if (rest.length > 0) {
      this.#routes.set(key, rest);
    }
    return Promise.resolve(head);
  }
}
