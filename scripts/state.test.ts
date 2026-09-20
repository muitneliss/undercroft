/**
 * The `no-usestate` rule, pinned from both sides -- including the `components/ui/**` exemption.
 *
 * `.ast-grep/rules/no-usestate.yml` is the only enforcement of `.claude/rules/state.md`'s
 * `useState` ban, and per `.claude/rules/tests.md` a guard needs two tests: one where it fires,
 * one where it stays quiet. This mirrors `scripts/layering.test.ts`'s mechanism exactly (mkdtemp
 * a throwaway project, copy the REAL rule files and sgconfig into it, write fixtures, run the
 * real pinned `ast-grep` binary) so this cannot pass against a stale copy of the rule.
 *
 * Fixture paths below are rooted at the literal string `apps/ui/...`, not `apps/demo/...` as
 * `layering.test.ts` uses -- `no-usestate.yml`'s `files:` is anchored to `"apps/ui/**"` itself
 * (`useState` is a React concern with no equivalent glob elsewhere), unlike the layer rules,
 * which match on directory name alone. An `apps/demo/...` fixture would stay quiet for the wrong
 * reason: it would never match `files:` at all, exemption or not.
 *
 * No Docker, no network: it runs the `ast-grep` binary this repo already pins as a
 * devDependency, which is the same one `bun run lint:rules` runs.
 */

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const AST_GREP = join(REPO, "node_modules", ".bin", "ast-grep");

const FIXTURES: Record<string, string> = {
  "apps/ui/src/components/Foo.tsx": `
    import { useState } from "react";
    export function Foo(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return open ? <span>{String(setOpen)}</span> : null;
    }
  `,
  "apps/ui/src/components/Bar.tsx": `
    export function Bar(): React.JSX.Element {
      return <span>quiet</span>;
    }
  `,
  // The exemption: shadcn's vendored primitives under components/ui/** call useState internally.
  "apps/ui/src/components/ui/Baz.tsx": `
    import { useState } from "react";
    export function Baz(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return open ? <span>{String(setOpen)}</span> : null;
    }
  `,
};

interface Finding {
  readonly ruleId: string;
  readonly file: string;
}

let project = "";
let findings: Finding[] = [];

function rulesOn(file: string): string[] {
  return findings.filter((f) => f.file === file).map((f) => f.ruleId);
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-state-"));

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

describe("useState is refused in application UI code", () => {
  it("a component calling useState is refused", () => {
    expect(rulesOn("apps/ui/src/components/Foo.tsx")).toContain("no-usestate-tsx");
  });

  it("a component with no useState is not", () => {
    expect(rulesOn("apps/ui/src/components/Bar.tsx")).toEqual([]);
  });
});

describe("components/ui/** is exempt: it is vendored shadcn source, not application state", () => {
  it("a vendored primitive calling useState internally is not refused", () => {
    expect(rulesOn("apps/ui/src/components/ui/Baz.tsx")).toEqual([]);
  });
});
