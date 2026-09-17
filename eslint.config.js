import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * The rules that matter here are not style rules.
 *
 * `no-restricted-syntax` below is the only thing standing between
 * `.claude/rules/money.md` and a rounded invoice total. The platform goes to
 * real lengths to keep money out of a float: `big.js` end to end, NUMERIC(18,4),
 * explicit Postgres type parsers that return `numeric` as a string, wire types
 * that carry the digits as a string, and a gate test that walks every schema
 * looking for a bare number under a money-shaped key.
 *
 * All of that is undone by one `Number(invoice.total)`, because JavaScript's
 * only numeric type IS a float. A reviewer cannot reliably catch that. A lint
 * rule can.
 *
 * These rules were proven in the Python-era `ui/` package and are deliberately
 * promoted to the repo root: in an all-TypeScript monorepo the language boundary
 * that once justified scoping them to one directory no longer exists, and money
 * now crosses the server too.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.d.ts",
      // Build/tooling config outside any tsconfig project; not app code.
      "**/vite.config.ts",
      "**/*.config.js",
    ],
  },
  js.configs.recommended,
  // Type-aware rules apply only to sources. Spreading them at the top level
  // makes ESLint try to type-check this config file, which is in no tsconfig
  // project, and the run dies before linting anything.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message:
            "parseFloat produces a float. Money is a string end to end -- parse it with parseAmount() from @undercroft/core and format it with formatMoney().",
        },
      ],

      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='Number']",
          message:
            "Number() produces a float. Money is a string end to end; see @undercroft/core/money.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name=/^(parseFloat|parseInt)$/]",
          message: "Number.parseFloat/parseInt produce a float. See @undercroft/core/money.",
        },
        {
          selector: "UnaryExpression[operator='+'][argument.type!='Literal']",
          message:
            "Unary + coerces to a float. If this is money, use formatMoney(); if it is a count, it is already a number.",
        },
        {
          // `Big#toNumber()` is the float you spent a library avoiding. It exists
          // for charting, and a chart is not a ledger.
          selector: "MemberExpression[property.name='toNumber']",
          message:
            "toNumber() discards precision. Keep the Big, or render with toFixed(); see @undercroft/core/money.",
        },
        // A rule banning `.toFixed()` was tried here and removed deliberately.
        // A selector cannot distinguish `Number#toFixed` (rounds an already-lossy
        // float) from `Big#toFixed` (exact, and the correct way to render), because
        // that needs type information ESLint does not have -- so it fired on every
        // legitimate `toBig(m).plus(x).toFixed(4)`. A rule that fights correct code
        // gets worked around, and then it protects nothing. The coercion bans above
        // already stop a `number` from existing in a money path, and payload numbers
        // are read through lossless-json rather than JSON.parse.
        {
          // tests.md: a suite that asserts a mock was called is green whether or
          // not the code works. Every port in this repo has a real in-memory
          // implementation; use it.
          selector:
            "MemberExpression[object.name=/^(vi|jest)$/][property.name=/^(mock|spyOn|fn)$/]",
          message:
            "Do not mock. Use the real in-memory implementation from @undercroft/testing and assert on observable behaviour.",
        },
      ],

      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "decimal.js",
              message:
                "decimal.js yields NaN on unparseable input, which propagates silently and prints as a value. A guessed amount is worse than a thrown one. Use big.js via @undercroft/core.",
            },
            {
              name: "decimal.js-light",
              message: "Same NaN semantics as decimal.js. Use big.js via @undercroft/core.",
            },
            {
              name: "dinero.js",
              message:
                "dinero forces a scale decision at parse time, which we cannot make for an arbitrary source string. Use big.js via @undercroft/core.",
            },
            {
              name: "bun:test",
              importNames: ["mock", "spyOn", "jest"],
              message:
                "Do not mock. Use the real in-memory implementation from @undercroft/testing.",
            },
          ],
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Third-party payloads genuinely are unknown; that is the point of the
      // raw lake. They are Zod-parsed at the boundary instead.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // An object literal asserted to a branded contract type bypasses the Zod
      // parse that is the only runtime check TypeScript does not give us.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
    },
  },
  {
    // The UI may reference the control plane's router only as a TYPE. A value import would
    // bundle the server -- and with it `pg` and the secret-key loader -- into the browser.
    // `allowTypeImports` lets `import type { AppRouter }` through and blocks everything else.
    files: ["apps/ui/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@undercroft/control-plane",
              message: "Import the router as a type only; a value import bundles the server.",
              allowTypeImports: true,
            },
            {
              name: "@undercroft/control-plane/router",
              message: "Import AppRouter as a type only; a value import bundles the server.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    // Tests may import from anywhere and use non-null assertions on fixtures
    // they just created.
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}", "**/scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      // Two rules below fight `bun:test` rather than catching bugs, and only in tests:
      //
      // `require-await`: a fake operation must be `async () => { throw ... }` to match a
      // `() => Promise<T>` port even though it has no `await`. That is the contract being
      // tested, not an oversight.
      //
      // `await-thenable`: `bun:test` types `expect(p).rejects.toThrow()` as returning
      // `void`, though it is genuinely async at runtime -- so awaiting it, which is
      // correct, is flagged. A real "awaited a non-promise" bug in test logic surfaces as
      // a hang or a wrong assertion, not as a passing test.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
    },
  },
);
