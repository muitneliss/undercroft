/**
 * Emit the connector spec's JSON Schema to `specs/schema/connector.v1.json`.
 *
 * The schema is what gives a spec author editor autocomplete and inline validation via
 * the `# yaml-language-server: $schema=` line at the top of each spec. It is generated
 * from the same Zod schema the runtime validates against, so the editor and the runtime
 * never disagree about what a valid spec is.
 */

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ConnectorSpec } from "../src/connectorSpec.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const outPath = join(repoRoot, "specs", "schema", "connector.v1.json");

const schema = zodToJsonSchema(ConnectorSpec, {
  name: "Connector",
  $refStrategy: "none",
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`);
process.stdout.write(`wrote ${outPath}\n`);
