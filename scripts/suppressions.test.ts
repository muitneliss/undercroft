/**
 * The suppression ban, pinned from both sides.
 *
 * `.ast-grep/rules/no-biome-ignore-all.yml` is the only enforcement of
 * `.claude/rules/suppressions.md`, and it fails in two directions. Too narrow and the 524
 * headers ADR 0018 removed come back one PR at a time. Too wide is worse: a rule that fires
 * on every test suite gets switched off within a day, and then nothing is enforced -- which
 * is how the repo got 679 headers in the first place.
 *
 * So each guard gets the two tests `.claude/rules/tests.md` requires, one where it fires and
 * one where it stays quiet, against fixtures in a throwaway project. The REAL rule files and
 * the REAL `biome.jsonc` are copied in, not described a second time, so this cannot pass
 * against a stale copy of either.
 *
 * The last test is the one that matters most and is not about ast-grep at all. It runs Biome
 * itself to show that `// biome-ignore-all lint:` DOES silence the money plugin -- the
 * measured fact the blanket ban exists for. If a Biome upgrade ever closes that hole, this
 * test fails, and that is the right moment to reconsider the rule rather than a year later.
 *
 * No Docker, no network: the `ast-grep` and `biome` binaries this repo already pins.
 */

// biome-ignore-all lint/correctness/noNodejsModules: A build-tier script on Bun; `node:` is the platform here.
// biome-ignore-all lint/correctness/noUndeclaredVariables: Bun's own `Bun`, which tsc resolves and Biome's resolver does not model.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Two reads of a reporter's JSON, which genuinely is `unknown` until parsed.

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const AST_GREP = join(REPO, "node_modules", ".bin", "ast-grep");
const BIOME = join(REPO, "node_modules", ".bin", "biome");

/**
 * A violating fixture and a compliant twin for each guard, because "the rule did not fire"
 * is only evidence when something nearby would have made it fire.
 */
const FIXTURES: Record<string, string> = {
  // no-biome-ignore-all-ts / -tsx: banned in source, allowed in a suite.
  "packages/demo/src/header.ts": `
    // biome-ignore-all lint/style/noTernary: a file-wide permit
    export const x = 1;
  `,
  "packages/demo/src/clean.ts": `
    export const x = 1;
  `,
  "apps/ui/src/header.tsx": `
    // biome-ignore-all lint/style/noTernary: a file-wide permit
    export const x = 1;
  `,
  "apps/ui/src/clean.tsx": `
    export const x = 1;
  `,
  "packages/demo/src/header.test.ts": `
    // biome-ignore-all lint/style/noTernary: answered for tests in biome.jsonc
    export const x = 1;
  `,

  // no-blanket-biome-ignore: banned everywhere, a test suite included.
  "packages/demo/src/blanket.test.ts": `
    // biome-ignore-all lint: reaches the money plugin
    export const x = 1;
  `,
  "packages/demo/src/pluginGroup.ts": `
    // biome-ignore-all lint/plugin: reaches the money plugin
    export const x = 1;
  `,

  // no-ast-grep-ignore
  "packages/demo/src/escape.ts": `
    // ast-grep-ignore
    export const x = 1;
  `,
};

interface Finding {
  readonly ruleId: string;
  readonly file: string;
}

interface Diagnostic {
  readonly category: string;
  readonly location: { readonly path: string };
}

let project = "";
let findings: Finding[] = [];

let biomeProject = "";
let biomeDiagnostics: Diagnostic[] = [];

/** Which rules fired on one fixture file. */
function rulesOn(file: string): string[] {
  return findings.filter((f) => f.file === file).map((f) => f.ruleId);
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-suppressions-"));

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
  const scanned = await new Response(scan.stdout).text();
  await scan.exited;
  findings = JSON.parse(scanned) as Finding[];

  // A second project for the Biome half: the real config, the real plugins, and one money
  // violation under a blanket suppression.
  biomeProject = mkdtempSync(join(tmpdir(), "undercroft-suppressions-biome-"));
  copyFileSync(join(REPO, "biome.jsonc"), join(biomeProject, "biome.jsonc"));
  const plugins = join(biomeProject, ".biome", "plugins");
  mkdirSync(plugins, { recursive: true });
  const pluginSource = join(REPO, ".biome", "plugins");
  for (const name of readdirSync(pluginSource)) {
    copyFileSync(join(pluginSource, name), join(plugins, name));
  }
  mkdirSync(join(biomeProject, "src"), { recursive: true });
  writeFileSync(join(biomeProject, "src/guarded.ts"), "export const total = Number(row.amount);\n");
  writeFileSync(
    join(biomeProject, "src/blanket.ts"),
    "// biome-ignore-all lint: the hole the ast-grep rule exists to close\nexport const total = Number(row.amount);\n",
  );

  const lint = Bun.spawn([BIOME, "lint", "--reporter=json", "--vcs-enabled=false", "."], {
    cwd: biomeProject,
    stdout: "pipe",
    stderr: "pipe",
  });
  const linted = await new Response(lint.stdout).text();
  await lint.exited;
  ({ diagnostics: biomeDiagnostics } = JSON.parse(linted) as { diagnostics: Diagnostic[] });
});

afterAll(() => {
  for (const dir of [project, biomeProject]) {
    if (dir !== "") {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("the biome-ignore-all ban", () => {
  it("fires on a source file that carries a file-wide header", () => {
    expect(rulesOn("packages/demo/src/header.ts")).toContain("no-biome-ignore-all-ts");
    expect(rulesOn("apps/ui/src/header.tsx")).toContain("no-biome-ignore-all-tsx");
  });

  it("stays quiet on a source file that carries none", () => {
    expect(rulesOn("packages/demo/src/clean.ts")).toEqual([]);
    expect(rulesOn("apps/ui/src/clean.tsx")).toEqual([]);
  });

  it("leaves a test suite its headers, which biome.jsonc answers instead", () => {
    expect(rulesOn("packages/demo/src/header.test.ts")).not.toContain("no-biome-ignore-all-ts");
  });
});

describe("the blanket-suppression ban", () => {
  it("fires on lint: and lint/plugin:, in a suite as well as in source", () => {
    expect(rulesOn("packages/demo/src/blanket.test.ts")).toContain("no-blanket-biome-ignore-ts");
    expect(rulesOn("packages/demo/src/pluginGroup.ts")).toContain("no-blanket-biome-ignore-ts");
  });

  it("stays quiet on a header that names one rule", () => {
    expect(rulesOn("packages/demo/src/header.ts")).not.toContain("no-blanket-biome-ignore-ts");
  });
});

describe("the ast-grep-ignore ban", () => {
  it("fires on the second escape hatch", () => {
    expect(rulesOn("packages/demo/src/escape.ts")).toContain("no-ast-grep-ignore-ts");
  });

  it("stays quiet where there is none", () => {
    expect(rulesOn("packages/demo/src/clean.ts")).not.toContain("no-ast-grep-ignore-ts");
  });
});

describe("why the blanket spelling is banned", () => {
  it("reports a money violation in an ordinary file", () => {
    const reported = biomeDiagnostics
      .filter((d) => d.location.path === "src/guarded.ts")
      .map((d) => d.category);
    expect(reported).toContain("plugin");
  });

  it("does NOT report the same violation under biome-ignore-all lint:", () => {
    const reported = biomeDiagnostics
      .filter((d) => d.location.path === "src/blanket.ts")
      .map((d) => d.category);
    expect(reported).not.toContain("plugin");
  });
});
