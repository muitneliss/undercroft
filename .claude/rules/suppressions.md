---
description: A lint decision lives in biome.jsonc, never as a header in the file
paths: ["**/*.ts", "**/*.tsx", "biome.jsonc", ".ast-grep/rules/*.yml", ".biome/plugins/*.grit"]
---

# Where a lint decision goes

A suppression is a decision about what this codebase is allowed to do. It belongs somewhere a
reviewer can find every one of them at once, and somewhere a machine can tell you when one has
stopped being true. `biome.jsonc` is that place. A header at the top of a file is not.

The measurements behind this are in `docs/adr/0018`. The short version: a `biome-ignore-all`
silences the rule for the **whole file**, and Biome never reports one that has gone stale — so
17 of this repo's 679 headers were already dead while the gate was green.

## NEVER

- **NEVER write `// biome-ignore-all`, in any file, a test suite included.** It permits every
  future violation of that rule in that file, by someone who will not read your reason.
  Enforced: `.ast-grep/rules/no-biome-ignore-all.yml` fails `bun run lint:rules`, and
  therefore `bun run verify` and CI. Suites were exempt until the 241 headers in them were
  measured: 93 were already dead and 134 were the same sentence in every suite, which left
  the exemption protecting nothing. ADR 0022.
- **NEVER write the group-wide `lint:` or `lint/plugin:` spelling on a line-level
  `// biome-ignore` either.** Both silence the `money.grit` and `no-mocks.grit` plugins, which
  CLAUDE.md calls the two rules this repo most needs a machine to enforce. Measured against
  Biome 2.5.14; `plugin:` alone does not, and that is not a distinction to rely on.
- **NEVER write `// ast-grep-ignore`.** It switches off the layering, `useState` and
  suppression gates at a line, and nothing reports it. There are none in the tree.
- **NEVER switch a rule off repo-wide because it is noisy at three files.** Scope it to those
  three, so it stays on for the next file somebody writes.

## Follow

- **A rule that cannot hold ANYWHERE goes in the repo-wide `overrides` entry** in
  `biome.jsonc`, with a reason that says what the rule wants and why this codebase cannot give
  it. `noTernary` is off because a ternary chooses between two values and JSX has no other
  inline conditional; that sentence is in the config, once, not in 62 files.
- **A rule that cannot hold at NAMED PLACES gets a path entry.** `noSecrets` is off at the
  named files whose strings it misreads as credentials, each entry saying which, and on
  everywhere else. This is the form that
  replaced the headers, and the difference matters: an exception names its files, a switch
  does not.
- **A genuine one-off gets the line-level `// biome-ignore`**, which Biome expires by itself —
  `bun run lint` runs with `--error-on-warnings`, so an unused one fails the gate. This is the
  only suppression form a source file or a suite may carry, and the whole tree holds **ten**
  across eight files:
  - a `^` that flips a GCM tag bit;
  - a control range that IS the assertion;
  - a compose file's `${IMAGE_TAG:-latest}` quoted as fixture bytes, twice;
  - an integration suite's `process.env` gate and its CommonJS `pg` import;
  - a refusal-reason catalogue key long enough to read as a secret;
  - the `PATH` the CLI suite and the CLI pack check hand to the process they spawn;
  - the charting `Big#toNumber()` below.
- **A plugin is suppressed by NAME: `// biome-ignore lint/plugin/money:`.** Measured against
  Biome 2.5.14: naming the plugin silences that plugin and no other, and Biome reports the
  suppression as unused when the violation on that line came from a different one — which is
  exactly the property `lint/plugin:` throws away. `apps/ui/src/lib/plot.ts` is the one place
  in the tree that needs it, for the `Big#toNumber()` that positions a chart; money.grit's own
  docstring sanctions that call and says why a chart is not a ledger.
- **A framework's domain is `none` unless that framework is in `package.json`.** Turning
  `solid` on in a repo with no Solid does not add strictness, it adds 255 findings that were
  never about this codebase, and the suppressions they force teach readers to skip
  suppressions. Turn a domain back on the day its dependency arrives.
- **Say what you measured.** Every entry in `biome.jsonc` names the finding count, the file,
  or the transcript behind it — `noUnnecessaryConditions` is off with the `tsc` error code
  that proves the rule wrong, not with an opinion about it. A reason a reader cannot check is
  the thing this rule file exists to stop.

Both guards are pinned from both sides — they fire, and they stay quiet — by
`scripts/suppressions.test.ts`, which runs the real rule files and the real `biome.jsonc`.
