import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * The rules that matter here are not style rules.
 *
 * `no-restricted-syntax` below is the only thing standing between
 * `.claude/rules/data-integrity.md` and a rounded invoice total. The backend
 * goes to real lengths to keep money out of a float -- Decimal end to end,
 * NUMERIC(18,4), a response model that carries the digits as a string, and a
 * gate test that walks every JSON Schema looking for `"type": "number"`. All of
 * that is undone by one `Number(invoice.total)` in a component, because
 * JavaScript's number IS a float.
 *
 * A reviewer cannot reliably catch that. A lint rule can.
 */
export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  js.configs.recommended,
  // Type-aware rules apply only to the source. Spreading them at the top level
  // makes ESLint try to type-check this config file, which is not in the
  // tsconfig project, and the run dies before linting anything.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message:
            "parseFloat produces a float. Money crosses the wire as a string; format it with formatMoney() from @/lib/money and never parse it.",
        },
      ],

      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='Number']",
          message:
            "Number() produces a float. Money crosses the wire as a string; format it with formatMoney() from @/lib/money and never parse it.",
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: "Number.parseFloat produces a float. See @/lib/money.",
        },
        {
          selector: "UnaryExpression[operator='+'][argument.type!='Literal']",
          message:
            "Unary + coerces to a float. If this is money, use formatMoney(); if it is a count, the API already sends it as a number.",
        },
        {
          // tests.md: a suite that asserts a mock was called is green whether or
          // not the code works. MSW gives us a real in-memory server instead.
          selector: "MemberExpression[object.name='vi'][property.name=/^(mock|spyOn|fn)$/]",
          message:
            "Do not mock. Use the in-memory API server in @/test/server and assert on what the user sees.",
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The API's `unknown`-typed jsonb config genuinely is unknown.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    // Test files may import from anywhere and use non-null assertions on
    // fixtures they just created.
    files: ["**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
