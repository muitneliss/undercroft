/**
 * The test-file override in `biome.jsonc`, pinned from both sides.
 *
 * `biome.jsonc` switches seven rules OFF for `**\/*.test.ts(x)` -- the ones whose reason is
 * "because it is a test" rather than anything about the file. ADR 0017 records why they are
 * disabled in the config rather than suppressed at the file; ADR 0018 extends the same
 * reasoning to the rules that cannot hold anywhere in this repo, which is why this is no
 * longer the only override. Three of the original ten left for that wider block:
 * `noMagicNumbers` and `useValidTestTitle` are off repo-wide now, and
 * `useQwikValidLexicalScope` went with the Qwik domain -- scoping any of them to tests had
 * stopped saying anything.
 *
 * A scoped `off` fails in two directions and, as with the GritQL plugins, the quiet one is
 * worse. Too narrow, and the suppression headers this replaced come back file by file. Too
 * WIDE is the dangerous one: a glob that accidentally matched everything, or an `off` that
 * reset its whole group under `preset: "all"`, would leave the suite reporting nothing at
 * all -- and a lint run that reports nothing looks exactly like a clean one.
 *
 * So the fixtures come in a pair. `probe.ts` and `probe.test.ts` hold the SAME code; the
 * only difference between them is the name, which is the whole of what the override keys on.
 * The third assertion is the one that matters: a money violation in the `.test.ts` fixture is
 * still reported, so this is an override and not Biome skipping the suite.
 *
 * Four of the seven are not exercised here, and deliberately: the suite itself pins them.
 * Their `biome-ignore-all` headers are gone from ~60 test files, so dropping any one from the
 * override fails `bun run lint` on the files that needed it.
 *
 * The REAL `biome.jsonc` is copied in -- byte for byte, not a second description of it --
 * along with the `.biome/plugins` it names, so this cannot pass against a stale copy of the
 * override. `--vcs-enabled=false` stands in for the git root a temp directory does not have,
 * which is the one thing the copied config cannot supply for itself.
 *
 * No Docker, no network: it runs the `biome` binary this repo already pins, the same one
 * `bun run lint` runs.
 */

// biome-ignore-all lint/correctness/noNodejsModules: This is a build-tier script running on Bun. `node:` builtins are the platform here, not a portability hazard.
// biome-ignore-all lint/correctness/noUndeclaredVariables: Globals the runtime supplies that Biome's resolver does not model -- Bun's own `Bun`. tsc resolves it, and tsc is the check that binds here.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: One read of the reporter's JSON, which genuinely is `unknown` until it is parsed. Every field touched after it is checked for what it must be.

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const BIOME = join(REPO, "node_modules", ".bin", "biome");

/**
 * One body, written twice under two names.
 *
 * It trips three of the overridden rules at once -- `noBunModules` on the `bun:test` import,
 * `noNodejsModules` on the `node:fs` one, `useExpect` on a test body that asserts nothing --
 * and the money plugin, which is not overridden anywhere and must survive in both.
 *
 * The fixtures sit at `src/probe.ts`, which matches none of the path-scoped overrides ADR
 * 0018 added, so `noNodejsModules` is genuinely on for the twin. That is the point: the only
 * thing that may silence it here is the name `.test.ts`.
 */
const BODY = `import { test } from "bun:test";
import { readFileSync } from "node:fs";

export function probe(path: string): boolean {
  test("x", () => undefined);
  return readFileSync(path, "utf8") === "";
}

export const total = Number(row.amount);
`;

const TWIN = "src/probe.ts";
const SUITE = "src/probe.test.ts";

interface Diagnostic {
  readonly category: string;
  readonly location: { readonly path: string };
}

let project = "";
let diagnostics: Diagnostic[] = [];

/** The rule categories raised against one fixture file. */
function rulesOn(file: string): string[] {
  return diagnostics.filter((d) => d.location.path === file).map((d) => d.category);
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-biome-test-override-"));

  // The real config, and the plugins it names by relative path.
  copyFileSync(join(REPO, "biome.jsonc"), join(project, "biome.jsonc"));
  const plugins = join(project, ".biome", "plugins");
  mkdirSync(plugins, { recursive: true });
  const source = join(REPO, ".biome", "plugins");
  for (const name of readdirSync(source)) {
    copyFileSync(join(source, name), join(plugins, name));
  }

  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, TWIN), BODY);
  writeFileSync(join(project, SUITE), BODY);

  // Exit status is non-zero whenever anything matched, which is the expected case here.
  const scan = Bun.spawn([BIOME, "lint", "--reporter=json", "--vcs-enabled=false", "."], {
    cwd: project,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(scan.stdout).text();
  await scan.exited;
  ({ diagnostics } = JSON.parse(out) as { diagnostics: Diagnostic[] });
});

afterAll(() => {
  if (project !== "") {
    rmSync(project, { recursive: true, force: true });
  }
});

describe("the test-file override", () => {
  it("leaves the rules on everywhere else, so the twin is reported", () => {
    expect(rulesOn(TWIN)).toEqual(
      expect.arrayContaining([
        "lint/nursery/noBunModules",
        "lint/correctness/noNodejsModules",
        "lint/nursery/useExpect",
      ]),
    );
  });

  it("silences them in a file whose only difference is the name", () => {
    const reported = rulesOn(SUITE);
    expect(reported).not.toContain("lint/nursery/noBunModules");
    expect(reported).not.toContain("lint/style/noMagicNumbers");
    expect(reported).not.toContain("lint/nursery/useExpect");
  });

  it("still lints the suite -- money that became a float is reported there too", () => {
    expect(rulesOn(SUITE)).toContain("plugin");
  });
});
