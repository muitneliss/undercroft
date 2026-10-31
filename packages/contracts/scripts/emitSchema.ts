/**
 * Emit the connector spec's JSON Schema to `specs/schema/connector.v1.json`.
 *
 * The schema is what gives a spec author editor autocomplete and inline validation via
 * the `# yaml-language-server: $schema=` line at the top of each spec. It is generated
 * from the same Zod schema the runtime validates against, so the editor and the runtime
 * never disagree about what a valid spec is.
 *
 * It describes the spec as written (`io: "input"`), so a field with a default is optional, as
 * it is to the runtime. Zod leaves a plain object open in that mode; `closeObject` closes it,
 * as the schema always has been. The runtime drops an unknown key rather than refusing it, but
 * in a hand-written spec an unknown key is nearly always a misspelt one that silently does
 * nothing, and the editor's squiggle is the only place that mistake is ever seen.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { z } from "zod";
import { ConnectorSpec } from "../src/connectorSpec.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const outPath = join(repoRoot, "specs", "schema", "connector.v1.json");

function closeObject({ zodSchema, jsonSchema }: Parameters<CloseObject>[0]): void {
  const { def } = zodSchema._zod;
  if (def.type === "object" && def.catchall === undefined) {
    jsonSchema.additionalProperties = false;
  }
}
type CloseObject = NonNullable<NonNullable<Parameters<typeof z.toJSONSchema>[1]>["override"]>;

const { $schema, ...connector } = z.toJSONSchema(ConnectorSpec, {
  target: "draft-07",
  io: "input",
  override: closeObject,
});

const schema = { $schema, $ref: "#/definitions/Connector", definitions: { Connector: connector } };

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`);
process.stdout.write(`wrote ${outPath}\n`);
