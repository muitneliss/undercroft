/**
 * A control sits on its field's line -- the rule, and the class it demands, pinned from both
 * sides.
 *
 * Two halves answer one defect (docs/adr/0027). `.ast-grep/rules/row-field-alignment.yml`
 * refuses a `.field` written as a child of a bare `.row`; `.row--field` in
 * `apps/ui/src/index.css` is what that refusal sends the author to. Either half can rot on
 * its own -- a rule that stops matching, or a class that stops aligning -- and neither
 * failure shows up anywhere else in the gate, because a misaligned button renders perfectly.
 *
 * The rule half mirrors `scripts/state.test.ts` exactly (mkdtemp a throwaway project, copy
 * the REAL rule files and sgconfig into it, run the pinned `ast-grep` binary), so it cannot
 * pass against a stale copy of the rule.
 *
 * That the class still ALIGNS anything is a question about a stylesheet and a computed
 * value, so it is asked where the DOM lives: `apps/ui/src/layout.test.ts`. What is asked
 * here is the one thing about the sheet this rule depends on and that no computed value can
 * show -- the `:has(> .field)` net beside the class, which catches the field arriving from a
 * child component or a `.map` where no linter can follow it. happy-dom's selector engine
 * does not implement `:has()` at this version, so it is pinned structurally instead: every
 * block that names `.row--field` must name the net too, and the two cannot drift into saying
 * different things.
 *
 * No Docker, no network.
 */

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const AST_GREP = join(REPO, "node_modules", ".bin", "ast-grep");
const SHEET = join(REPO, "apps", "ui", "src", "index.css");

/**
 * The fixtures, by path. A compliant twin for every violating file: "the rule did not fire"
 * is only evidence if something nearby would have made it fire.
 */
const FIXTURES: Record<string, string> = {
  // Fires: the defect itself, as it shipped on the lake's search band.
  "apps/ui/src/components/Centred.tsx": `
    export function Centred(): React.JSX.Element {
      return (
        <form className="row">
          <label className="field" htmlFor="q">
            <span className="label">Keyword</span>
            <input className="input" id="q" name="q" type="search" />
          </label>
          <button className="plate" type="submit">Search</button>
        </form>
      );
    }
  `,
  // Quiet: the same markup, told which line it sits on.
  "apps/ui/src/components/Aligned.tsx": `
    export function Aligned(): React.JSX.Element {
      return (
        <form className="row row--field">
          <label className="field" htmlFor="q">
            <span className="label">Keyword</span>
            <input className="input" id="q" name="q" type="search" />
          </label>
          <button className="plate" type="submit">Search</button>
        </form>
      );
    }
  `,
  // Quiet: a row of plates is what `.row`'s centring is FOR.
  "apps/ui/src/components/Plates.tsx": `
    export function Plates(): React.JSX.Element {
      return (
        <div className="row">
          <button className="plate" type="button">One</button>
          <button className="plate" type="button">Two</button>
        </div>
      );
    }
  `,
  // Quiet: `.field__hint` is a paragraph, not a field. The rule reads whole classes, so a
  // rule written with a substring match would fail here and nowhere else.
  "apps/ui/src/components/Hint.tsx": `
    export function Hint(): React.JSX.Element {
      return (
        <div className="row">
          <p className="field__hint">A note beside the controls.</p>
          <button className="plate" type="button">Go</button>
        </div>
      );
    }
  `,
  // Fires: a childless element carrying the class. `<X className="field" />` parses as a
  // different node kind from `<div className="field"></div>`, and a rule that named only
  // the second would be quiet here for a reason that has nothing to do with the layout.
  "apps/ui/src/components/SelfClosing.tsx": `
    export function SelfClosing({ Box }: { Box: React.ComponentType<{ className: string }> }): React.JSX.Element {
      return (
        <div className="row">
          <Box className="field" />
          <button className="plate" type="button">Go</button>
        </div>
      );
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

/** Every rule block's selector list, comments stripped. Flat blocks, which is this sheet. */
function selectorLists(css: string): string[] {
  const bare = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
  return [...bare.matchAll(/(?<selectors>[^{}]+)[{][^{}]*[}]/gu)].map(
    (block) => block.groups?.selectors?.trim() ?? "",
  );
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-alignment-"));

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

describe("a field written into a centred row is refused", () => {
  it("a form pairing a labelled field with a button is refused", () => {
    expect(rulesOn("apps/ui/src/components/Centred.tsx")).toContain("row-field-alignment");
  });

  it("a childless element carrying the class is refused too", () => {
    expect(rulesOn("apps/ui/src/components/SelfClosing.tsx")).toContain("row-field-alignment");
  });

  it("the same form on `row--field` is not", () => {
    expect(rulesOn("apps/ui/src/components/Aligned.tsx")).toEqual([]);
  });

  it("a row of plates is not", () => {
    expect(rulesOn("apps/ui/src/components/Plates.tsx")).toEqual([]);
  });

  it("a row holding a field__hint is not: it is a paragraph, not a field", () => {
    expect(rulesOn("apps/ui/src/components/Hint.tsx")).toEqual([]);
  });
});

describe("the net under the rule cannot drift away from the class", () => {
  it("every block naming row--field names the :has selector beside it", () => {
    const naming = selectorLists(readFileSync(SHEET, "utf8")).filter((list) =>
      list.includes(".row--field"),
    );
    expect(naming.length).toBeGreaterThan(0);
    for (const list of naming) {
      expect(list).toContain(".row:has(> .field)");
    }
  });
});
