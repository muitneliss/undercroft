/**
 * `realSpawn` against a real child, because every other suite fakes it.
 *
 * The fakes in the extract suites say what a program wrote to each stream, so they cannot notice
 * the one thing that went wrong here in production: the real spawn joined the streams, and a
 * program's remarks on stderr were stored as documents' text. This is the only place the real
 * seam is run, and the one promise it pins is that the streams arrive apart.
 */

import { describe, expect, test as it } from "bun:test";
import { tmpdir } from "node:os";

import { realSpawn } from "./transform.ts";

describe("realSpawn", () => {
  it("keeps a child's stdout and stderr apart", async () => {
    // `/bin/sh` by path and `printf` as its builtin, so the child needs no PATH at all.
    const result = await realSpawn(["/bin/sh", "-c", "printf answer; printf remark >&2"], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 10_000,
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: "answer",
      stderr: "remark",
      timedOut: false,
    });
  });

  it("says when its own deadline is what stopped the child, so a kill is not mistaken for a crash", async () => {
    // `exec` so the shell is replaced by the sleeper: the kill must reach the process that
    // holds the pipes open, or the read waits out the thirty seconds.
    const result = await realSpawn(["/bin/sh", "-c", "exec sleep 30"], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});
