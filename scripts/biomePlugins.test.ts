/**
 * The GritQL plugins, pinned from both sides.
 *
 * `.biome/plugins/*.grit` is the only enforcement of the two rules this repo most needs a
 * machine to hold -- `.claude/rules/money.md` (an amount never becomes a float) and
 * `.claude/rules/tests.md` (do not mock) -- plus the browser-bundle rule that keeps the
 * server out of the UI. Biome ships no `no-restricted-syntax`, so when ESLint was removed
 * these patterns became the whole of that enforcement.
 *
 * A pattern fails in two directions and the quiet one is worse. During this migration the
 * money plugin silently stopped loading because a regex capture group is read by GritQL as
 * a variable binding, and separately the `ui-server-import` plugin ran on nothing at all
 * because Biome 2.5.14 accepts a `{ path, includes }` plugin entry and then never invokes
 * it. Both failures look exactly like a clean run. Nothing but a test that asserts the
 * plugin FIRES can tell the difference.
 *
 * So each plugin gets the two tests `.claude/rules/tests.md` asks for -- one where it fires
 * and one where it stays quiet -- against fixtures in a throwaway project in the system temp
 * directory. The REAL `.grit` files are copied in, so this cannot pass against a stale copy.
 *
 * No Docker, no network: it runs the `biome` binary this repo already pins, the same one
 * `bun run lint` runs.
 */

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const BIOME = join(REPO, "node_modules", ".bin", "biome");

/**
 * A violating fixture and a compliant twin for each pattern. The twin matters as much as the
 * violation: "the plugin did not fire" is only evidence if something nearby would have made
 * it fire, and a plugin that failed to load is quiet on both.
 */
const FIXTURES: Record<string, string> = {
  // money.grit -- the coercions
  "src/coerces.ts": `
    export const total = Number(row.amount);
    export const ratio = Number.parseFloat(row.rate);
    export const flat = big.toNumber();
    export const coerced = +row.amount;
  `,
  // ...and the spellings that are deliberately still allowed. `Number.parseInt` is here on
  // purpose: the ESLint rule this was ported from banned it, which left no legal way to read
  // a port, because `useNumberNamespace` rewrites the bare global into exactly this form.
  "src/counts.ts": `
    export const port = Number.parseInt(raw, 10);
    export const one = +1;
    export const amount = parseAmount(row.amount);
    export const isInt = Number.isInteger(port);
  `,

  // no-mocks.grit
  "src/mocks.test.ts": `
    export const a = vi.fn();
    export const b = vi.spyOn(obj, "m");
    export const c = jest.mock("./x.ts");
  `,
  "src/real.test.ts": `
    import { InMemoryObjectStore } from "@undercroft/testing";
    export const store = new InMemoryObjectStore();
  `,

  // ui-server-import.grit -- fires only under apps/ui, and only on a VALUE import
  "apps/ui/src/bundlesServer.ts": `
    import { createCaller } from "@undercroft/control-plane/router";
    export const x = createCaller;
  `,
  "apps/ui/src/typeOnly.ts": `
    import type { AppRouter } from "@undercroft/control-plane";
    export type X = AppRouter;
  `,
  "apps/ui/src/inlineTypeOnly.ts": `
    import { type AppRouter } from "@undercroft/control-plane";
    export type X = AppRouter;
  `,
  // The same value import outside the browser bundle. The server packages import each other
  // by value legitimately, so this one must stay quiet -- it pins the plugin's `$filename`
  // scope, which is the part that silently did nothing when it lived in the config instead.
  "packages/db/src/importsServer.ts": `
    import { createCaller } from "@undercroft/control-plane/router";
    export const x = createCaller;
  `,

  // ui-model-provider.grit -- a model provider carries an API key, so the browser may not
  // import one in ANY position. No type-only carve-out, unlike the router above.
  "apps/ui/src/bundlesProvider.ts": `
    import { createAnthropic } from "@ai-sdk/anthropic";
    export const x = createAnthropic;
  `,
  "apps/ui/src/bundlesJudge.ts": `
    import { noul } from "@typesafe-ai/sdk";
    export const x = noul;
  `,
  // The browser's own half of the AI SDK, which holds no credential and must stay allowed --
  // without this the rule could be tightened into uselessness and nothing would notice.
  "apps/ui/src/usesChat.ts": `
    import { useChat } from "@ai-sdk/react";
    export const x = useChat;
  `,
  // And the provider where it belongs: the control plane's composition root.
  "apps/control-plane/src/buildsProvider.ts": `
    import { createAnthropic } from "@ai-sdk/anthropic";
    export const x = createAnthropic;
  `,
};

interface Diagnostic {
  readonly category: string;
  readonly message: string;
  readonly location: { readonly path: string };
}

let project = "";
let diagnostics: Diagnostic[] = [];

/** The plugin messages raised against one fixture file. */
function pluginMessagesOn(file: string): string[] {
  return diagnostics
    .filter((d) => d.category === "plugin" && d.location.path === file)
    .map((d) => d.message);
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "undercroft-biome-plugins-"));

  // The real plugins, copied -- not a second description of them.
  const plugins = join(project, ".biome", "plugins");
  mkdirSync(plugins, { recursive: true });
  const source = join(REPO, ".biome", "plugins");
  const names = readdirSync(source);
  for (const name of names) {
    copyFileSync(join(source, name), join(plugins, name));
  }

  // A config that enables ONLY the plugins. The rule set is off so a fixture written to trip
  // a pattern cannot be reported by some unrelated rule instead and look like a pass.
  writeFileSync(
    join(project, "biome.json"),
    `${JSON.stringify(
      {
        plugins: names.map((n) => `./.biome/plugins/${n}`),
        linter: { enabled: true, rules: { recommended: false } },
        formatter: { enabled: false },
      },
      null,
      2,
    )}\n`,
  );

  for (const [path, body] of Object.entries(FIXTURES)) {
    const target = join(project, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${body.trim()}\n`);
  }

  // Exit status is non-zero whenever anything matched, which is the expected case here.
  const scan = Bun.spawn([BIOME, "lint", "--reporter=json", "."], {
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

describe("money never becomes a float, and the plugin says so", () => {
  it("refuses Number(), Number.parseFloat, toNumber() and unary +", () => {
    const messages = pluginMessagesOn("src/coerces.ts").join("\n");
    expect(messages).toContain("Number() produces a float");
    expect(messages).toContain("Number.parseFloat produces a float");
    expect(messages).toContain("toNumber() discards precision");
    expect(messages).toContain("Unary + coerces to a float");
  });

  it("leaves integer parsing, numeric literals and parseAmount alone", () => {
    expect(pluginMessagesOn("src/counts.ts")).toEqual([]);
  });
});

describe("a mock is refused wherever it is spelled", () => {
  it("refuses vi.fn, vi.spyOn and jest.mock", () => {
    expect(pluginMessagesOn("src/mocks.test.ts")).toHaveLength(3);
  });

  it("leaves a real in-memory implementation alone", () => {
    expect(pluginMessagesOn("src/real.test.ts")).toEqual([]);
  });
});

describe("the UI may reach the control-plane router only as a type", () => {
  it("refuses a value import inside the browser bundle", () => {
    expect(pluginMessagesOn("apps/ui/src/bundlesServer.ts").join("\n")).toContain(
      "bundles the server",
    );
  });

  it("allows `import type`", () => {
    expect(pluginMessagesOn("apps/ui/src/typeOnly.ts")).toEqual([]);
  });

  it("allows an inline `{ type X }` specifier, which is erased just the same", () => {
    expect(pluginMessagesOn("apps/ui/src/inlineTypeOnly.ts")).toEqual([]);
  });

  it("leaves the same import alone outside apps/ui, where it is legitimate", () => {
    expect(pluginMessagesOn("packages/db/src/importsServer.ts")).toEqual([]);
  });
});

describe("ui-model-provider.grit keeps a model provider out of the browser", () => {
  it("refuses `@ai-sdk/anthropic` under apps/ui", () => {
    // The key that provider is constructed with lives in the control plane's process. A
    // browser bundle importing it is a bundle whose only missing ingredient is the key.
    expect(pluginMessagesOn("apps/ui/src/bundlesProvider.ts").join(" ")).toContain(
      "must not import a model provider",
    );
  });

  it("refuses `@typesafe-ai/sdk` there too", () => {
    expect(pluginMessagesOn("apps/ui/src/bundlesJudge.ts").join(" ")).toContain(
      "must not import a model provider",
    );
  });

  it("allows `@ai-sdk/react`, which is the browser's own half and holds no key", () => {
    // The quiet side, and the one that matters most: a rule that banned the whole SDK would
    // pass the two tests above while making the feature impossible.
    expect(pluginMessagesOn("apps/ui/src/usesChat.ts")).toEqual([]);
  });

  it("allows the provider in the control plane, where the key belongs", () => {
    expect(pluginMessagesOn("apps/control-plane/src/buildsProvider.ts")).toEqual([]);
  });
});
