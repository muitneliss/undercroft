/**
 * Parse and validate a connector spec from YAML text.
 *
 * A parse failure names the path that failed, because "invalid connector" sends someone
 * to read the whole file while "entities.0.idPath: Required" points at the line. The
 * connector spec is the surface users author by hand, so its error messages are part of
 * the API.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noParameterProperties: TypeScript parameter properties in two classes. The alternative is declaring each field and then assigning it in the constructor, which is the same information written twice.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useErrorCause: Two throws that deliberately do not chain: the original carries a provider's raw response, and attaching it would put an unreviewed payload into a log line.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { ConnectorSpec } from "./connectorSpec.ts";

export class SpecError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = "SpecError";
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "(root)" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}

export function parseSpec(text: string): ConnectorSpec {
  let tree: unknown;
  try {
    tree = parseYaml(text);
  } catch (error) {
    throw new SpecError(`connector spec is not valid YAML: ${(error as Error).message}`);
  }

  const result = ConnectorSpec.safeParse(tree);
  if (!result.success) {
    const issues = formatIssues(result.error);
    throw new SpecError(`connector spec is invalid:\n  ${issues.join("\n  ")}`, issues);
  }
  return result.data;
}
