/**
 * Validate every shipped connector spec against the schema. Part of the gate.
 *
 * A broken spec is a new failure mode the moment connectors become YAML, and it is cheap
 * to catch here rather than at the first scheduled run. Exits non-zero, with the offending
 * path, on the first invalid file.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseSpec, SpecError } from "../src/loadSpec.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const specDir = join(repoRoot, "specs", "connectors");

const files = readdirSync(specDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
if (files.length === 0) {
  process.stdout.write("no connector specs to validate\n");
  process.exit(0);
}

let failures = 0;
for (const file of files) {
  const path = join(specDir, file);
  try {
    const spec = parseSpec(readFileSync(path, "utf8"));
    process.stdout.write(`ok    ${file} (${spec.entities.length} entities)\n`);
  } catch (error) {
    failures += 1;
    if (error instanceof SpecError) {
      process.stderr.write(`FAIL  ${file}\n  ${error.issues.join("\n  ") || error.message}\n`);
    } else {
      process.stderr.write(`FAIL  ${file}\n  ${(error as Error).message}\n`);
    }
  }
}

if (failures > 0) {
  process.stderr.write(`\n${failures} spec(s) failed validation\n`);
  process.exit(1);
}
