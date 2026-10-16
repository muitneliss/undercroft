/**
 * The access rules (`.ast-grep/rules/no-role-literal-gate.yml`), pinned from both sides.
 *
 * They are the only machine enforcement of `.claude/rules/access.md`'s "decide on a permission,
 * never on a role's name" (ADR 0139), and per `.claude/rules/tests.md` a guard needs two tests:
 * one where it fires, one where it stays quiet. The mechanism is `scripts/state.test.ts`'s
 * exactly -- a throwaway project, the REAL rule files and sgconfig copied in, fixtures written,
 * the pinned `ast-grep` binary run -- so this cannot pass against a stale copy of the rule.
 *
 * Fixture paths are rooted at the literal `apps/ui/...` and `apps/control-plane/...` the rules'
 * `files:` name; anywhere else they would stay quiet for the wrong reason.
 */

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const AST_GREP = join(REPO, "node_modules", ".bin", "ast-grep");

const FIXTURES: Record<string, string> = {
  // A screen gating on the role's name: what every gate in the UI was before ADR 0139.
  "apps/ui/src/routes/Gate.tsx": `
    export function Gate({ tenant }: { tenant: { role: string } }): React.JSX.Element | null {
      return tenant.role === "admin" ? <span>admin</span> : null;
    }
  `,
  // The literal on the left, and a negation, in a plain module.
  "apps/ui/src/lib/gate.ts": `
    export function authors(role: string): boolean {
      return "viewer" !== role;
    }
  `,
  // The server, as the assistant's handler once narrowed a role to three names.
  "apps/control-plane/src/handlers/narrow.ts": `
    export function narrowed(role: string): string | null {
      return role === "member" || role === "builder" ? role : null;
    }
  `,
  // Quiet: the gate it should have been.
  "apps/ui/src/routes/Allowed.tsx": `
    import { can } from "@/lib/permissions.ts";
    export function Allowed({ permissions }: { permissions: readonly string[] }): React.JSX.Element | null {
      return can(permissions, "people:manage") ? <span>people</span> : null;
    }
  `,
  // Quiet: a role that is not a tenant role, and the last-admin rule naming its role by constant.
  "apps/ui/src/lib/turns.ts": `
    import { ADMIN_ROLE } from "@undercroft/contracts/access";
    export function fromReader(turn: { role: string }): boolean {
      return turn.role === "user";
    }
    export function admins(members: readonly { role: string }[]): number {
      return members.filter((member) => member.role === ADMIN_ROLE).length;
    }
  `,
  // Quiet: a suite seeds and asserts roles by name.
  "apps/control-plane/src/handlers/gate.test.ts": `
    export const isAdmin = (role: string): boolean => role === "admin";
  `,
  // The browser computing rights from a role through the shared table.
  "apps/ui/src/lib/rights.ts": `
    import { BUILT_IN_GRANTS } from "@undercroft/contracts/access";
    export const builderRights = BUILT_IN_GRANTS.builder;
  `,
  // Quiet: a fixture standing in for the server's answer may read it.
  "apps/ui/src/test/access.ts": `
    import { BUILT_IN_GRANTS } from "@undercroft/contracts/access";
    export const held = (role: "viewer"): readonly string[] => BUILT_IN_GRANTS[role];
  `,
};

interface Finding {
  readonly ruleId: string;
  readonly file: string;
}

let project = "";
let findings: Finding[] = [];

function rulesOn(file: string): string[] {
  return [...new Set(findings.filter((f) => f.file === file).map((f) => f.ruleId))].sort();
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-access-"));

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

describe("a gate on a role's name is refused", () => {
  it("in a screen", () => {
    expect(rulesOn("apps/ui/src/routes/Gate.tsx")).toEqual(["no-role-literal-gate-tsx"]);
  });

  it("with the name on the left, negated, in a plain module", () => {
    expect(rulesOn("apps/ui/src/lib/gate.ts")).toEqual(["no-role-literal-gate-ts"]);
  });

  it("in the control plane", () => {
    expect(rulesOn("apps/control-plane/src/handlers/narrow.ts")).toEqual([
      "no-role-literal-gate-ts",
    ]);
  });
});

describe("what is not a gate on a role's name stays quiet", () => {
  it("a gate on a permission", () => {
    expect(rulesOn("apps/ui/src/routes/Allowed.tsx")).toEqual([]);
  });

  it("a chat turn's role, and the last-admin rule naming its role by constant", () => {
    expect(rulesOn("apps/ui/src/lib/turns.ts")).toEqual([]);
  });

  it("a suite", () => {
    expect(rulesOn("apps/control-plane/src/handlers/gate.test.ts")).toEqual([]);
  });
});

describe("the browser does not read the built-in grants", () => {
  it("a module computing a role's rights from them is refused", () => {
    expect(rulesOn("apps/ui/src/lib/rights.ts")).toEqual(["no-role-policy-in-ui-ts"]);
  });

  it("a fixture standing in for the server's answer may", () => {
    expect(rulesOn("apps/ui/src/test/access.ts")).toEqual([]);
  });
});
