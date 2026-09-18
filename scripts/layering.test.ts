/**
 * The layering rules, pinned from both sides.
 *
 * `.ast-grep/rules/layer-*.yml` is the only enforcement of `.claude/rules/layering.md`, and
 * an ast-grep rule fails in two directions: it can stop matching what it was written for,
 * and it can start matching code that is fine. The second failure is the dangerous one --
 * a rule that flags every tRPC procedure and every `RegExp#exec` gets switched off within a
 * day, and then nothing is enforced at all. Both of those were real: the first draft did
 * exactly that.
 *
 * So each guard gets the two tests `.claude/rules/tests.md` requires, one where it fires and
 * one where it stays quiet, against fixtures in a throwaway project in the system temp
 * directory. The REAL rule files are copied into it, so this cannot pass against a stale
 * copy of them.
 *
 * No Docker, no network: it runs the `ast-grep` binary this repo already pins as a
 * devDependency, which is the same one `bun run lint:rules` runs.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const AST_GREP = join(REPO, "node_modules", ".bin", "ast-grep");

/**
 * The fixtures, by path. A compliant twin for every violating file, because "the rule did
 * not fire" is only evidence if something nearby would have made it fire.
 */
const FIXTURES: Record<string, string> = {
  // layer-handler-no-repo
  "apps/demo/src/handlers/reachesRepo.ts": `
    import { findTenant } from "../repos/tenant.ts";
    export const x = findTenant;
  `,
  "apps/demo/src/handlers/viaService.ts": `
    import { get } from "../services/tenants.ts";
    export const x = get;
  `,

  // layer-service-no-upward
  "apps/demo/src/services/importsTransport.ts": `
    import { Hono } from "hono";
    export const x = Hono;
  `,
  "apps/demo/src/services/tenants.ts": `
    import { findTenant } from "../repos/tenant.ts";
    export const get = findTenant;
  `,

  // layer-repo-no-upward
  "apps/demo/src/repos/importsService.ts": `
    import { get } from "../services/tenants.ts";
    export const x = get;
  `,
  "apps/demo/src/repos/tenant.ts": `
    import type { SqlExecutor } from "@undercroft/db";
    export async function findTenant(exec: SqlExecutor, id: string): Promise<unknown> {
      const { rows } = await exec.query("SELECT id FROM ops.tenant WHERE id = $1", [id]);
      return rows[0];
    }
  `,

  // layer-shared-no-layer
  "packages/core/src/reachesLayer.ts": `
    import { get } from "../../../apps/demo/src/services/tenants.ts";
    export const x = get;
  `,
  "packages/core/src/pure.ts": `
    export function add(a: number, b: number): number {
      return a + b;
    }
  `,

  // layer-sql-in-repos. The two quiet cases are the false positives that made the first
  // draft of the rule unusable: a tRPC procedure's `.query`, and English that reads like SQL.
  "apps/demo/src/services/withSql.ts": `
    import type { SqlExecutor } from "@undercroft/db";
    export async function find(exec: SqlExecutor, email: string): Promise<unknown> {
      const { rows } = await exec.query("SELECT id FROM app.app_user WHERE email = $1", [email]);
      return rows[0];
    }
  `,
  "apps/demo/src/handlers/trpcStyle.ts": `
    const authedProcedure = { query: (resolve: () => number) => resolve };
    export const me = authedProcedure.query(() => 1);
  `,
  "apps/demo/src/services/prose.ts": `
    export const EMPTY = "Select a source from the list to begin.";
  `,

  // layer-injected-deps
  "apps/demo/src/services/readsEnv.ts": `
    export function keyOf(): string | undefined {
      return process.env.UNDERCROFT_SECRET_KEY;
    }
  `,
  "apps/demo/src/services/takesDeps.ts": `
    export function keyOf(deps: { env: NodeJS.ProcessEnv }): string | undefined {
      return deps.env.UNDERCROFT_SECRET_KEY;
    }
  `,

  // layer-no-driver-import
  "apps/demo/src/repos/usesDriver.ts": `
    import { Pool } from "pg";
    export const x = Pool;
  `,
};

interface Finding {
  readonly ruleId: string;
  readonly file: string;
}

let project = "";
let findings: Finding[] = [];

/** Which rules fired on one fixture file. */
function rulesOn(file: string): string[] {
  return findings.filter((f) => f.file === file).map((f) => f.ruleId);
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-layering-"));

  // The real rules and the real project config, copied -- not a second description of them.
  const rules = join(project, ".ast-grep", "rules");
  mkdirSync(rules, { recursive: true });
  const source = join(REPO, ".ast-grep", "rules");
  for (const name of readdirSync(source)) copyFileSync(join(source, name), join(rules, name));
  copyFileSync(join(REPO, "sgconfig.yml"), join(project, "sgconfig.yml"));

  for (const [path, body] of Object.entries(FIXTURES)) {
    const target = join(project, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${body.trim()}\n`);
  }

  // Exit status is 1 whenever anything matched, which is the expected case here.
  const scan = Bun.spawn([AST_GREP, "scan", "--json=compact", "."], {
    cwd: project,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(scan.stdout).text();
  await scan.exited;
  findings = JSON.parse(out) as Finding[];
});

afterAll(() => {
  if (project !== "") rmSync(project, { recursive: true, force: true });
});

describe("the dependency direction is enforced, not described", () => {
  test("a handler importing a repo is refused", () => {
    expect(rulesOn("apps/demo/src/handlers/reachesRepo.ts")).toContain("layer-handler-no-repo");
  });

  test("a handler importing a service is not", () => {
    expect(rulesOn("apps/demo/src/handlers/viaService.ts")).toEqual([]);
  });

  test("a service importing a transport library is refused", () => {
    expect(rulesOn("apps/demo/src/services/importsTransport.ts")).toContain(
      "layer-service-no-upward",
    );
  });

  test("a service importing a repo is not", () => {
    expect(rulesOn("apps/demo/src/services/tenants.ts")).toEqual([]);
  });

  test("a repo importing a service is refused", () => {
    expect(rulesOn("apps/demo/src/repos/importsService.ts")).toContain("layer-repo-no-upward");
  });

  test("a repo importing only the executor seam is not", () => {
    expect(rulesOn("apps/demo/src/repos/tenant.ts")).toEqual([]);
  });

  test("a shared package importing a layer is refused", () => {
    expect(rulesOn("packages/core/src/reachesLayer.ts")).toContain("layer-shared-no-layer");
  });

  test("a shared package that imports no layer is not", () => {
    expect(rulesOn("packages/core/src/pure.ts")).toEqual([]);
  });
});

describe("SQL is confined to the repo layer", () => {
  test("a statement in a service is refused", () => {
    expect(rulesOn("apps/demo/src/services/withSql.ts")).toContain("layer-sql-in-repos");
  });

  test("the same statement inside a repo is not", () => {
    expect(rulesOn("apps/demo/src/repos/tenant.ts")).toEqual([]);
  });

  test("a tRPC procedure's .query is not a database call", () => {
    // The whole router matched before the receiver was constrained.
    expect(rulesOn("apps/demo/src/handlers/trpcStyle.ts")).toEqual([]);
  });

  test("prose that reads like SQL is not a statement", () => {
    // "Select a source from the list" has no schema-qualified table, so it is not ours.
    expect(rulesOn("apps/demo/src/services/prose.ts")).toEqual([]);
  });
});

describe("dependencies arrive as arguments", () => {
  test("a service reading process.env is refused", () => {
    expect(rulesOn("apps/demo/src/services/readsEnv.ts")).toContain("layer-injected-deps");
  });

  test("a service reading an injected env is not", () => {
    expect(rulesOn("apps/demo/src/services/takesDeps.ts")).toEqual([]);
  });

  test("importing the pg driver outside its seam is refused", () => {
    expect(rulesOn("apps/demo/src/repos/usesDriver.ts")).toContain("layer-no-driver-import");
  });
});
