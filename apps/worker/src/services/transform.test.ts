import { describe, expect, test } from "bun:test";
import { runTransform } from "./transform.ts";

const dirs = { projectDir: "/app/dbt/undercroft_starter", profilesDir: "/app/dbt" };

describe("runTransform invokes dbt and reports honestly", () => {
  test("builds the project with the right directories", async () => {
    let seen: readonly string[] = [];
    const result = await runTransform({
      ...dirs,
      spawn: (cmd) => {
        seen = cmd;
        return Promise.resolve({ exitCode: 0, output: "Completed successfully" });
      },
    });

    expect(result.ok).toBe(true);
    expect(seen[0]).toBe("dbt");
    expect(seen[1]).toBe("build");
    expect(seen).toContain("--project-dir");
    expect(seen).toContain(dirs.projectDir);
  });

  test("passes a --select through when given one", async () => {
    let seen: readonly string[] = [];
    await runTransform(
      {
        ...dirs,
        spawn: (cmd) => {
          seen = cmd;
          return Promise.resolve({ exitCode: 0, output: "ok" });
        },
      },
      { select: "stg_hubspot_deals" },
    );
    expect(seen).toContain("--select");
    expect(seen).toContain("stg_hubspot_deals");
  });

  test("a non-zero exit raises rather than reporting success", async () => {
    // A failed transform must not report success: the previous tables keep serving, which
    // is stale rather than wrong, and only an error says so.
    await expect(
      runTransform({
        ...dirs,
        spawn: () => Promise.resolve({ exitCode: 1, output: "Database Error in model x" }),
      }),
    ).rejects.toThrow(/exited 1/u);
  });

  test("only the tail of dbt output is returned, never the whole log", async () => {
    // dbt's log can echo row values from a failing test; those belong in `dq`, not in an
    // HTTP response.
    const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const result = await runTransform({
      ...dirs,
      spawn: () => Promise.resolve({ exitCode: 0, output: long }),
    });
    expect(result.output.split("\n").length).toBeLessThanOrEqual(20);
    expect(result.output).not.toContain("line 0");
  });
});
