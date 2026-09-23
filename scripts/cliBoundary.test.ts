/**
 * The CLI boundary rule, pinned from both sides.
 *
 * `.ast-grep/rules/cli-boundary.yml` is the only thing that keeps `apps/cli` a caller of the
 * platform rather than a second way into it (ADR 0044). An import rule fails in two
 * directions: it can stop matching the import it was written for, and it can start matching
 * code that is fine -- the type-only import of the router, the build script that reads it, the
 * suite that starts the real server. Either failure ends with the rule switched off.
 *
 * So each case gets a firing fixture and a quiet twin, in a throwaway project that holds the
 * REAL rule files and project config, scanned by the `ast-grep` binary `bun run lint:rules`
 * runs. The same method as `layering.test.ts`. No Docker, no network.
 */

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const AST_GREP = join(REPO, "node_modules", ".bin", "ast-grep");
const RULE = "cli-no-backdoor";

const FIXTURES: Record<string, string> = {
  // Fires: the in-process shortcut, three spellings of it.
  "apps/cli/src/handlers/inProcess.ts": `
    import { appRouter } from "@undercroft/control-plane/router";
    export const caller = appRouter;
  `,
  "apps/cli/src/services/withDsn.ts": `
    import { createPool } from "@undercroft/db";
    export const pool = createPool;
  `,
  "apps/cli/src/handlers/dynamic.ts": `
    export async function open(): Promise<unknown> {
      return await import("@undercroft/db");
    }
  `,
  "apps/cli/src/handlers/reexport.ts": `
    export { createAuth } from "better-auth";
  `,

  // Quiet: the transport, a type-only import, a shared package, and the two exempt places.
  "apps/cli/src/handlers/remote.ts": `
    import { httpLink } from "@trpc/client";
    import type { AppRouter } from "@undercroft/control-plane/router";
    import { DEFAULT_LOCALE } from "@undercroft/core/locale";
    export const link = httpLink;
    export type Router = AppRouter;
    export const locale = DEFAULT_LOCALE;
  `,
  "apps/cli/src/cli.test.ts": `
    import { startControlPlane } from "@undercroft/control-plane/testing";
    export const start = startControlPlane;
  `,
  "apps/cli/scripts/build.ts": `
    import { appRouter } from "@undercroft/control-plane/router";
    export const router = appRouter;
  `,
};

interface Finding {
  readonly ruleId: string;
  readonly file: string;
}

let project = "";
let findings: Finding[] = [];

function firedOn(file: string): boolean {
  return findings.some((finding) => finding.file === file && finding.ruleId === RULE);
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-cli-boundary-"));
  const rules = join(project, ".ast-grep", "rules");
  mkdirSync(rules, { recursive: true });
  const source = join(REPO, ".ast-grep", "rules");
  for (const name of readdirSync(source)) {
    copyFileSync(join(source, name), join(rules, name));
  }
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
  if (project !== "") {
    rmSync(project, { recursive: true, force: true });
  }
});

describe("the CLI cannot open a second way into the platform", () => {
  it("importing the router by value is refused", () => {
    expect(firedOn("apps/cli/src/handlers/inProcess.ts")).toBe(true);
  });

  it("opening the database seam is refused", () => {
    expect(firedOn("apps/cli/src/services/withDsn.ts")).toBe(true);
  });

  it("a dynamic import of the database is refused too", () => {
    expect(firedOn("apps/cli/src/handlers/dynamic.ts")).toBe(true);
  });

  it("re-exporting Better Auth is refused", () => {
    expect(firedOn("apps/cli/src/handlers/reexport.ts")).toBe(true);
  });
});

describe("the CLI's legitimate imports are left alone", () => {
  it("the HTTP transport, a type-only router import and a shared package are not refused", () => {
    expect(firedOn("apps/cli/src/handlers/remote.ts")).toBe(false);
  });

  it("the suite may start the real control plane", () => {
    expect(firedOn("apps/cli/src/cli.test.ts")).toBe(false);
  });

  it("the build may read the router, because it ships data and not the router", () => {
    expect(firedOn("apps/cli/scripts/build.ts")).toBe(false);
  });
});
